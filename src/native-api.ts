import * as Crypto from 'expo-crypto';

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

// "12345678" -> "1234 5678" while typing.
export function formatEnrollmentCode(value: string) {
  const d = normalizeEnrollmentCode(value).slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 4)} ${d.slice(4)}` : d;
}

export function encodeAndroidEnrollmentPayload(input: { codeSha256: string; installIdHash: string; deviceLabel: string }) {
  return JSON.stringify([1, 'android_enrollment', input.codeSha256, input.installIdHash, input.deviceLabel]);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
}
