import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

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
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', body: form, signal: abort.signal });
  } catch (err) {
    // An abort is a timeout, and saying so is the difference between trying again
    // somewhere with signal and trying the same spot twice more.
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error('That took too long to send. Check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
}
