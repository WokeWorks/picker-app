// Fingerprint/face gate for OPENING the app.
//
// WHAT THIS IS FOR
// Replacing "type your mobile number and wait for a web page" with one touch.
// That is the whole point: on a registered phone the picker's shift should be on
// screen in about a second.
//
// WHAT THIS IS NOT
// It is NOT a security control on the punch path, and it must never be described
// as one. The server authenticates the phone by the install secret held in
// SecureStore; it has no idea whether a biometric prompt ran on the way in. A
// phone handed over already unlocked can still be used. The thing that actually
// proves WHO is punching is the face check against the reference photo — see
// docs/picker-app-face-and-lock.md in the dashboard repo.
//
// So: local convenience gate. Real identity proof lives on the server.

import * as LocalAuthentication from 'expo-local-authentication';

// How long the app stays unlocked after going to the background. Long enough to
// glance at a WhatsApp message or check the store name without re-scanning;
// short enough that a phone left on a shelf re-locks on its own.
export const UNLOCK_GRACE_MS = 2 * 60 * 1000;

// Module-level, not React state, so it survives screen changes and remounts
// within a single app run. It is deliberately NOT persisted: a cold start always
// asks again, and nothing about the lock is written to disk.
let unlockedAt: number | null = null;
let inFlight: Promise<LocalAuthentication.LocalAuthenticationResult> | null = null;

export function isUnlocked(): boolean {
  return unlockedAt !== null && Date.now() - unlockedAt < UNLOCK_GRACE_MS;
}

/**
 * True while a prompt is on screen. The gate MUST consult this before re-locking
 * on an AppState change: showing the native biometric sheet makes the app report
 * itself inactive/backgrounded on both platforms, so a naive listener locks the
 * app the instant it asks to be unlocked and loops forever.
 */
export function isPrompting(): boolean {
  return inFlight !== null;
}

export function markLocked(): void {
  unlockedAt = null;
}

export async function requestUnlock(): Promise<LocalAuthentication.LocalAuthenticationResult> {
  if (inFlight) return inFlight;
  inFlight = LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock OpsPro',
    // Device fallback stays ON. Biometrics are the fast path; the phone's own
    // passcode, pattern or password is the credential underneath. This is the
    // shape banking apps use, and on Android it is one prompt, not two: the
    // module asks for BIOMETRIC_STRONG *or* DEVICE_CREDENTIAL together
    // (LocalAuthenticationModule.kt:209), and on a biometric-unavailable error it
    // retries with device credentials by itself (kt:165-174).
    //
    // Two things this buys, both of which cost nothing:
    //   * a picker whose finger will not read -- wet hands in a chiller aisle --
    //     still gets into their own shift, instead of being locked out with no
    //     way back.
    //   * a phone with a passcode but no usable fingerprint sensor can still open
    //     the app at all.
    //
    // And it gives up nothing, because this lock was never a security control:
    // the server authenticates the phone by its install secret, and the face
    // check at clock-in is what proves who is punching. Falling back to the
    // DEVICE credential rather than an app PIN also means the check stays in the
    // secure element, with hardware-enforced delays no app-level PIN could match.
    disableDeviceFallback: false,
    // Still asked for first when one is enrolled. Ignored for the credential
    // path, which is the point.
    biometricsSecurityLevel: 'strong',
    // No confirmation tap. The punch prompt asks for one because it commits
    // hours; opening the app commits nothing, and the extra tap is exactly the
    // friction this feature exists to remove.
    requireConfirmation: false,
  })
    .then((result) => {
      if (result.success) unlockedAt = Date.now();
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
