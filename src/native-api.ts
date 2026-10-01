import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import * as SecureStore from 'expo-secure-store';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://app.opspro.ae').replace(/\/$/, '');
export const GOOGLE_CLOUD_PROJECT_NUMBER = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER || '';
export const DEVICE_ID_KEY = 'opspro.device-id';
export const INSTALL_SECRET_KEY = 'opspro.install-secret';

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
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
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
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
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
