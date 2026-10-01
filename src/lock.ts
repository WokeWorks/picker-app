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

import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

// How long the app may stay AWAY before it re-locks. Long enough to glance at a
// WhatsApp message or check the store name without re-scanning; short enough that
// a phone left on a shelf re-locks on its own.
export const UNLOCK_GRACE_MS = 2 * 60 * 1000;

// Module-level, not React state, so it survives screen changes and remounts
// within a single app run. Deliberately NOT persisted: a cold start always asks
// again, and nothing about the lock is written to disk.
//
// `unlocked` is a FLAG, not a timestamp, and that is the fix for a real bug. It
// used to be the moment of the last unlock, with the grace measured from there --
// so the grace quietly expired while the picker was still using the app, and the
// next trivial interruption locked them out mid-task. The longer they stayed, the
// more certain that became, which is the opposite of what a grace period is for.
//
// The clock now starts when the app LEAVES. Time spent using the app does not
// count against it, because it never should have.
let unlocked = false;
let leftAt: number | null = null;
let inFlight: Promise<LocalAuthentication.LocalAuthenticationResult> | null = null;

/**
 * Still unlocked: either in use, or away for less than the grace period.
 *
 * `leftAt === null` means the app has not been backgrounded since the unlock, so
 * no time counts against it however long they have been on screen.
 */
export function isUnlocked(): boolean {
  if (!unlocked) return false;
  if (leftAt === null) return true;
  return Date.now() - leftAt < UNLOCK_GRACE_MS;
}

/**
 * The app has gone to the background. Starts the grace clock.
 *
 * Only a real 'background' calls this. Android never emits 'inactive' at all
 * (AppStateModule.kt emits active/background from onHostResume/onHostPause), and
 * on iOS 'inactive' is the transient state a notification shade or a Face ID
 * sheet produces -- neither is the picker leaving.
 */
export function markLeft(): void {
  if (leftAt === null) leftAt = Date.now();
}

/**
 * Whether the app has actually been away since the last unlock or return.
 *
 * This, not a remembered previous AppState, is what says "they really left".
 * Deriving it from the state machine was fragile: a platform that ever sent
 * background -> inactive -> active would have forgiven a genuine absence.
 */
export function hasBeenAway(): boolean {
  return leftAt !== null;
}

/** Back on screen. Stops the grace clock without granting anything. */
export function markReturned(): void {
  leftAt = null;
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
  unlocked = false;
  leftAt = null;
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
      if (result.success) {
        unlocked = true;
        // Normally cleared -- the time away has just been paid for by the scan.
        // But if the app is ALREADY backgrounded as this resolves (they pressed
        // Home just as Face ID succeeded), the clock has to start now, or the
        // grace would never begin and the app would still be unlocked hours
        // later with nothing able to re-lock it.
        leftAt = AppState.currentState === 'background' ? Date.now() : null;
      }
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
