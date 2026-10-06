import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import * as SecureStore from 'expo-secure-store';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://app.opspro.ae').replace(/\/$/, '');
export const GOOGLE_CLOUD_PROJECT_NUMBER = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER || '';
export const DEVICE_ID_KEY = 'opspro.device-id';
export const INSTALL_SECRET_KEY = 'opspro.install-secret';
/**
 * iOS only. The identifier of the Secure Enclave key Apple attested at setup; the
 * key itself never leaves the enclave. Without this, a punch cannot be signed, so
 * it is part of the credential and is cleared with it.
 */
export const APP_ATTEST_KEY_ID_KEY = 'opspro.app-attest-key-id';

export async function sha256(value: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

// Setup codes are 8 digits (shown "1234 5678"); only the digits count.
export function normalizeEnrollmentCode(value: string) {
  return value.replace(/\D/g, '');
}

// UAE mobile as typed: "050 123 4567". Accepts a leading +971 / 971 too; the
// server normalises and compares it with the number on the picker's profile.
export function phoneDigits(value: string) {
  let d = value.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('971')) d = '0' + d.slice(3);
  return d.slice(0, 10);
}
export function formatPhone(value: string) {
  const d = phoneDigits(value);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}
export function isUaeMobile(value: string) {
  return /^05\d{8}$/.test(phoneDigits(value));
}

// "12345678" -> "1234 5678" while typing.
export function formatEnrollmentCode(value: string) {
  const d = normalizeEnrollmentCode(value).slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 4)} ${d.slice(4)}` : d;
}

export function encodeAndroidEnrollmentPayload(input: { codeSha256: string; installIdHash: string; deviceLabel: string }) {
  return JSON.stringify([1, 'android_enrollment', input.codeSha256, input.installIdHash, input.deviceLabel]);
}

/**
 * The iOS twin, and the string App Attest signs at setup.
 *
 * Must match encodeIosEnrollmentPayload on the server byte for byte -- the server
 * rebuilds this string and hashes it to check Apple's nonce, so a stray space or a
 * reordered field fails setup with no useful message.
 *
 * The tag differs from the Android one so a payload can never be replayed across
 * platforms.
 */
export function encodeIosEnrollmentPayload(input: { codeSha256: string; installIdHash: string; deviceLabel: string }) {
  return JSON.stringify([1, 'ios_enrollment', input.codeSha256, input.installIdHash, input.deviceLabel]);
}

/**
 * Multipart POST, for a punch that carries the selfie.
 *
 * Takes the photo's `file://` uri and wraps it in expo-file-system's `File`,
 * which implements Blob and so is a real FormData part.
 *
 * NOT `{ uri, name, type }`. That was React Native's own convention for years and
 * it is what this function used first -- but RN 0.86 / SDK 57 follow the web
 * standard, where a part must be a string or a Blob, and anything else throws
 * "Unsupported FormDataPart implementation" at request time. TypeScript cannot
 * catch it, because making that object type-check at all needs a cast to Blob,
 * and the cast is the lie.
 *
 * `fetch` sets the multipart boundary itself from the FormData body. Setting
 * 'content-type' by hand here would omit the boundary and the server would parse
 * nothing -- the other common way this call goes wrong.
 */
/**
 * How long an upload may take before it is abandoned.
 *
 * Generous, because this is a photo over shop mobile data and a picker who is
 * told to retry too early simply uploads it twice.
 */
const UPLOAD_TIMEOUT_MS = 45_000;

/**
 * Deadline for ordinary JSON calls. Shorter than an upload: these carry no file,
 * so anything this slow is a dead connection rather than a big payload.
 */
const REQUEST_TIMEOUT_MS = 20_000;

export async function apiPostFile<T>(
  path: string,
  fields: Record<string, string>,
  fileUri: string,
): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new File(fileUri));
  // React Native's fetch has NO default timeout on Android, so a stalled upload on
  // shop mobile data never settles: the spinner runs forever, Send and Choose
  // again stay disabled, and the full-screen preview hides the way back. A
  // picker's only escape was the hardware back button.
  const { response, result } = await withTimeout(
    `${API_BASE_URL}${path}`,
    { method: 'POST', body: form },
    UPLOAD_TIMEOUT_MS,
    'That took too long to send. Check your connection and try again.',
  );
  await refuseOrThrow(response, result, typeof fields.install_secret === 'string' ? fields.install_secret : null);
  return result as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  /**
   * Override for calls that CHANGE SERVER STATE and cannot safely be retried.
   *
   * Enrolment consumes a one-time code, and a break punch may be applied before
   * the client gives up -- in both cases a premature timeout leaves the server
   * ahead of the phone, and the retry fails with "code already used" or a
   * wrong-state error that the picker cannot do anything about. They get the
   * upload budget instead of the read one.
   */
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const { response, result } = await withTimeout(
    `${API_BASE_URL}${path}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    // Deliberately not "pull down to try again": enrol, break and sign-out have
    // no pull-to-refresh, and telling someone to do something their screen cannot
    // do is worse than saying nothing.
    'The connection timed out. Check your connection and try again.',
  );
  await refuseOrThrow(response, result, secretFromBody(body));
  return result as T;
}

/**
 * The install_secret a request carried, if any.
 *
 * Read off the body rather than threaded through every caller: every
 * authenticated route takes it under this one name, and a route that does not
 * simply yields null, which refuseOrThrow treats as "cannot tell" and handles
 * conservatively.
 */
function secretFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).install_secret;
  return typeof value === 'string' ? value : null;
}

/**
 * fetch plus a deadline that covers the BODY as well as the headers.
 *
 * Two bugs this exists to prevent, both of which end with a screen spinning
 * forever on shop mobile data:
 *
 *   1. React Native's fetch has NO default timeout on Android, so a stalled
 *      request simply never settles. The profile screen's loading spinner had no
 *      way out at all.
 *   2. Clearing the timer as soon as fetch resolves is not enough. Headers can
 *      arrive inside the deadline and the BODY still hang, and response.json()
 *      would then wait forever with the timer already cancelled. The timer is
 *      cleared only after the body has been read.
 */
/**
 * Turn a failed response into a throw -- and, if the server says this phone is no
 * longer a registered device, DROP ITS CREDENTIAL on the way past.
 *
 * Shared by apiPost and apiPostFile deliberately. The first version of this lived
 * inline, and because both functions end in the same `if (!response.ok) throw`
 * line it was pasted into apiPostFile -- the file-upload path -- while every
 * screen goes through apiPost. The result was an infinite loop rather than a
 * silent miss: screens saw device_inactive and sent the picker to '/', index.tsx
 * still read a valid enrolment from SecureStore and sent them back to /clock, and
 * round it went, 94 requests deep before anyone stopped it. One function, one
 * call site each, so the two cannot drift apart again.
 *
 * WHY CLEARING IS SAFE HERE: the server distinguishes a revoked device
 * (device_inactive, 401) from a lookup it could not perform (service_unavailable,
 * 503) -- see src/lib/mobile-device-auth.ts. While both answered device_inactive,
 * a momentary database error would have un-enrolled a healthy phone, recoverable
 * only by a supervisor issuing a new setup code.
 *
 * Deleting is best effort. A keystore that refuses leaves the phone as it was,
 * which is no worse than not trying.
 */
async function refuseOrThrow(
  response: Response,
  result: { error?: string },
  /**
   * The install secret THIS request was sent with.
   *
   * Without it, a late answer destroys a credential it knows nothing about.
   * Sequence: a request goes out on secret A, the phone is revoked, the picker
   * enrols again and SecureStore now holds secret B -- and only then does the old
   * 401 arrive. Clearing "whatever is stored" would delete B, the working
   * credential they just obtained, and send them back to setup from a phone that
   * was fine. The failure belongs to A and must only be allowed to affect A.
   */
  sentSecret: string | null,
): Promise<void> {
  if (response.ok) return;
  if (result.error === 'device_inactive') {
    const current = await readEnrolment();
    if (!current.ok) {
      // The keystore would not say what is stored, so there is no way to know
      // whether this failure is still relevant. Destroying nothing is the only
      // safe answer -- see requireInstallSecret for the same reasoning.
      throw new Error('enrolment_unreadable');
    }
    if (sentSecret && current.secret && current.secret !== sentSecret) {
      // A newer enrolment replaced the credential this request used. The answer is
      // about a phone registration that no longer exists, so it is dropped: no
      // clearing, no navigation. Thrown as device_inactive so the screens stay
      // quiet about it, exactly as they do for the live case.
      throw new Error('device_inactive');
    }
    const cleared = await clearEnrolment();
    if (!cleared) {
      // NAVIGATING HERE WOULD LOOP. index.tsx decides "enrolled" from these two
      // keys, so sending a phone that still holds them to '/' bounces straight
      // back to /clock, which asks again, gets device_inactive again, and round
      // it goes. The picker is told instead -- a stuck keystore is rare, and a
      // sentence they can show a supervisor beats a screen that flickers.
      throw new Error('deregistered_stuck');
    }
    // CENTRAL, so no caller can forget. The load paths route themselves anyway,
    // but the ACTION paths -- punch, break, sending a document or a photo -- used
    // to show an alert and leave a revoked picker sitting in the clock or upload
    // UI with no way out. Doing it here covers every call that exists now and
    // every one added later.
    router.replace('/');
  }
  throw new Error(result.error || `Request failed (${response.status})`);
}

/**
 * The install secret, or a trip to setup.
 *
 * Every authenticated screen begins by reading this key, and each used to
 * `throw new Error('device_inactive')` when it was missing. That string is the
 * one the server sends for a REVOKED device, so the screens' handling of it
 * assumed apiPost had already cleared the credential and navigated -- which for a
 * locally-missing secret never happened. No request had run. The result was a
 * blank screen: spinner gone, no schedule, no error, no way to setup.
 *
 * Navigating here makes the assumption true for both paths. A phone with no
 * secret is not enrolled whatever index.tsx last decided, and setup is the only
 * screen that can help it.
 */
export async function requireInstallSecret(): Promise<string> {
  // THROUGH readEnrolment, not a bare getItemAsync with a catch. The first
  // version used `.catch(() => null)`, which treats a keystore that FAILED TO
  // ANSWER the same as one that answered "nothing here" -- so a transient read
  // error sent a perfectly healthy, enrolled phone to setup, and the picker could
  // not use the app until the keystore happened to recover.
  //
  // This codebase has drawn that line before and written it down: "A read that
  // THREW is 'I don't know', not 'not registered'". readEnrolment is where that
  // distinction lives, and it also normalises an empty string to null, which
  // matters because clearKey blanks a key when deleting fails.
  const enrolment = await readEnrolment();
  if (!enrolment.ok) {
    // Retryable, and deliberately NOT a navigation: nothing is known about this
    // phone, so nothing should be concluded about it.
    throw new Error('enrolment_unreadable');
  }
  if (enrolment.secret) return enrolment.secret;
  router.replace('/');
  throw new Error('device_inactive');
}

/**
 * Remove this phone's enrolment, and SAY WHETHER IT WORKED.
 *
 * Two deletes, each retried once, then a blanking write as a fallback -- an empty
 * string reads as not-enrolled everywhere (see isEnrolled), so a keystore that
 * refuses deletes can still be talked out of claiming this phone is registered.
 * The boolean is what callers need: whether it is safe to send the picker to
 * setup, or whether doing so would loop.
 *
 * Both keys matter and they do different jobs. INSTALL_SECRET_KEY authenticates
 * every call; DEVICE_ID_KEY is what index.tsx and LockGate read to decide this
 * phone is enrolled -- leaving that behind sends the picker to a clock screen
 * whose every request then fails.
 */
export async function clearEnrolment(): Promise<boolean> {
  // The App Attest key id goes with the rest. Leaving it behind would make the next
  // setup try to reuse a key the server has already registered, and the server holds
  // a unique index on the attested public key across every device row ever created
  // -- including revoked ones -- so that attempt could never succeed.
  const results = await Promise.all([
    clearKey(INSTALL_SECRET_KEY),
    clearKey(DEVICE_ID_KEY),
    clearKey(APP_ATTEST_KEY_ID_KEY),
  ]);
  return results.every(Boolean);
}

/**
 * The stored App Attest key id, or null.
 *
 * Null is normal on Android and never an error there. On iOS it means the
 * credential is incomplete and setup has to be repeated.
 */
export async function readAppAttestKeyId(): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(APP_ATTEST_KEY_ID_KEY);
    return value ? value : null;
  } catch {
    return null;
  }
}

/** Stores the App Attest key id after a successful setup. */
export async function writeAppAttestKeyId(keyId: string): Promise<void> {
  await SecureStore.setItemAsync(APP_ATTEST_KEY_ID_KEY, keyId, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Delete one key, retried once, then blanked.
 *
 * One retry, not a loop: a delete that fails twice is not transient, and the
 * picker should be told rather than held at a spinner.
 */
export async function clearKey(key: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await SecureStore.deleteItemAsync(key);
      return true;
    } catch {
      // Fall through to the retry, then to the blanking fallback below.
    }
  }
  try {
    await SecureStore.setItemAsync(key, '');
    return true;
  } catch {
    return false;
  }
}

async function withTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<{ response: Response; result: { error?: string } }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: abort.signal });
    // The catch RE-THROWS an abort rather than swallowing it. Catching everything
    // here turned a timed-out body read into `{}`, which every caller then read as
    // a successful response -- so a clock-out could report success having
    // committed nothing, and screens expecting fields got an empty object.
    //
    // A genuine parse failure still degrades to {}, because some routes answer
    // with no body and that is not an error.
    const result = await response.json().catch((e: unknown) => {
      if ((e as { name?: string })?.name === 'AbortError') throw e;
      return {};
    });
    // Belt and braces: an abort that lands between the two awaits leaves the
    // response readable but the result meaningless.
    if (abort.signal.aborted) throw new Error(timeoutMessage);
    return { response, result };
  } catch (err) {
    // Saying "timed out" rather than passing the raw error up is the difference
    // between moving somewhere with signal and retrying in the same dead spot.
    if ((err as { name?: string })?.name === 'AbortError') throw new Error(timeoutMessage);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What is stored on this phone about its enrolment.
 *
 * `ok: false` means a read THREW, which is not the same as the key being absent
 * and must never be treated as it. That distinction is the whole reason this
 * exists: a caller that collapses the two can conclude a healthy phone is
 * un-enrolled on a transient keystore error -- around boot, or a momentary
 * keystore hiccup -- and act on it irreversibly.
 */
export type Enrolment =
  | { ok: true; deviceId: string | null; secret: string | null }
  | { ok: false };

/**
 * Read both enrolment keys together.
 *
 * Both, because either alone is a lie. The device id is what decides which screen
 * opens; the secret is what authenticates every call. A phone holding one without
 * the other is not usable, and treating the device id alone as "enrolled" sent
 * pickers to a clock screen where every request failed, with nothing clearing the
 * stale key -- so reopening the app reproduced it forever.
 *
 * Empty strings are normalised to null, so a key blanked as a delete fallback
 * (see clearKey in app/profile.tsx) reads as absent here too.
 */
export async function readEnrolment(): Promise<Enrolment> {
  try {
    const [deviceId, secret] = await Promise.all([
      SecureStore.getItemAsync(DEVICE_ID_KEY),
      SecureStore.getItemAsync(INSTALL_SECRET_KEY),
    ]);
    return { ok: true, deviceId: deviceId || null, secret: secret || null };
  } catch {
    return { ok: false };
  }
}

/** Usable only when BOTH are present, and only when the read actually worked. */
export function isEnrolled(enrolment: Enrolment): boolean {
  return enrolment.ok && !!enrolment.deviceId && !!enrolment.secret;
}
