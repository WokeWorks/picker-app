import { Platform } from 'react-native';
import { GOOGLE_CLOUD_PROJECT_NUMBER } from '@/native-api';

// Device proof, per platform. Both answer the same question -- "is this a genuine,
// unmodified build of OpsPro on real hardware?" -- by opposite routes.
//
//   Android, Play Integrity  the phone fetches an opaque token bound to a request
//                            hash, and our server asks Google to decode it. Every
//                            punch costs a Google call.
//
//   iOS, App Attest          Apple attests a key held in the Secure Enclave ONCE,
//                            at setup. Afterwards the phone signs each punch with
//                            that key and our server checks the signature itself.
//
// @expo/app-integrity is loaded lazily: Expo Go ships without its native module,
// and a top-level import crashes every screen that imports it. Loaded here, only
// setup and punching need it, so the rest of the app still runs in Expo Go.
//
// DEV ONLY, BOTH PLATFORMS, SANDBOX ONLY. Neither vendor vouches for a build it did
// not distribute, so a locally built app cannot obtain real proof and nothing in the
// punch flow could be exercised before a store release exists. With this set the app
// sends a placeholder and the SANDBOX server skips the vendor check -- see the
// server's mobile-dev-bypass.ts, which refuses to open against production whatever
// is configured.
//
// iOS needs this MORE than Android, not less. An Android dev build at least receives
// a token Google will decode and judge. An iPhone without a paid Apple Developer
// account and the App Attest entitlement produces NOTHING: Apple refuses to sign, so
// there is no attestation to send and none to verify.
//
// WHAT THIS COSTS. A bypassed iOS enrolment stores a throwaway public key whose
// private half the server discarded, so nothing can ever sign with it and the punch
// path skips the signature check entirely. A device set up this way proves the app
// WORKS; it proves nothing about whether App Attest verification is correct. That
// still needs one real iPhone on a paid account, and it is still the release gate.
const DEV_SKIP_INTEGRITY = process.env.EXPO_PUBLIC_DEV_SKIP_INTEGRITY === '1';

// THESE TWO LITERALS ARE A CONTRACT WITH THE SERVER, which requires the exact string
// rather than treating the flag alone as a substitute for proof -- so that a phone
// presenting REAL material is still verified for real on a bypass-open server.
//
// They must stay identical to DEV_BYPASS_PLACEHOLDER_TOKEN and
// DEV_BYPASS_PLACEHOLDER_PROOF in app/src/lib/mobile-dev-bypass.ts. There is no
// shared module between the two repositories. Drift fails CLOSED -- setup falls
// through to real verification and is refused with code_or_phone_mismatch -- but the
// symptom is baffling, so change neither side without the other.
const DEV_PLACEHOLDER_TOKEN = 'dev-bypass-no-play-integrity';
const DEV_PLACEHOLDER_ATTESTATION = 'dev-bypass-no-app-attest';

type AppIntegrity = typeof import('@expo/app-integrity');

function loadAppIntegrity(): AppIntegrity {
  try {
    return require('@expo/app-integrity');
  } catch {
    throw new Error(
      Platform.OS === 'ios'
        ? 'This needs the App Store version of the app.'
        : 'This needs the Play Store version of the app.',
    );
  }
}

/** What the phone sends with a punch. Exactly one field, chosen by platform. */
export type PunchProof = { integrity_token: string } | { assertion: string };

/** What setup sends. iOS also returns the key id, which must be stored. */
export type SetupProof =
  | { platform: 'android'; integrity_token: string }
  | { platform: 'ios'; attestation: string; key_id: string };

// --- Android -----------------------------------------------------------------

async function playIntegrityToken(requestHash: string): Promise<string> {
  if (DEV_SKIP_INTEGRITY) {
    console.warn('[integrity] DEV BYPASS: sending a placeholder instead of a Play Integrity token.');
    return DEV_PLACEHOLDER_TOKEN;
  }
  if (!GOOGLE_CLOUD_PROJECT_NUMBER) throw new Error('This build of the app is not configured. Ask your supervisor.');
  const AppIntegrity = loadAppIntegrity();
  await AppIntegrity.prepareIntegrityTokenProviderAsync(GOOGLE_CLOUD_PROJECT_NUMBER);
  return AppIntegrity.requestIntegrityCheckAsync(requestHash);
}

// --- iOS ---------------------------------------------------------------------

function requireAppAttest(): AppIntegrity {
  const AppIntegrity = loadAppIntegrity();
  // False on the simulator and on older hardware: App Attest needs a Secure
  // Enclave. Said plainly, because "setup failed" on a simulator wastes an hour.
  if (!AppIntegrity.isSupported) {
    throw new Error('This iPhone cannot be set up for OpsPro. It does not support Apple App Attest.');
  }
  return AppIntegrity;
}

/**
 * Mints a NEW Secure Enclave key and has Apple attest it.
 *
 * Always a new key, never a stored one. The server holds a unique index on the
 * attested public key across every device row ever created, including revoked
 * ones, so a key can be registered exactly once in the lifetime of the database.
 * Re-using one after a phone was revoked would fail that index.
 *
 * `challenge` is hashed by the native module (SHA256 over its UTF-8 bytes) to form
 * Apple's clientDataHash, and the server recomputes the same hash from the same
 * string. The two must stay byte-identical, so pass the exact string the server
 * built -- never a re-encoded or trimmed copy.
 */
async function attestNewKey(challenge: string): Promise<{ attestation: string; keyId: string }> {
  const AppIntegrity = requireAppAttest();
  const keyId = await AppIntegrity.generateKeyAsync();
  const attestation = await AppIntegrity.attestKeyAsync(keyId, challenge);
  return { attestation, keyId };
}

/** Signs a punch with the key Apple attested at setup. */
async function signPunch(keyId: string, clientData: string): Promise<string> {
  const AppIntegrity = requireAppAttest();
  return AppIntegrity.generateAssertionAsync(keyId, clientData);
}

// --- What the screens call ---------------------------------------------------

/**
 * Proof for a punch.
 *
 * The two platforms sign DIFFERENT things, and the difference matters:
 *   Android  binds to `requestHash`, the hash the server gave us.
 *   iOS      signs `payload` itself, the raw string; the native module hashes it.
 *
 * Passing the hash to iOS would make the server verify a signature over the hash
 * of a hash and reject every punch.
 */
export async function requestPunchProof(args: {
  payload: string;
  requestHash: string;
  /** The stored App Attest key id. Required on iOS. */
  keyId: string | null;
}): Promise<PunchProof> {
  if (Platform.OS !== 'ios') {
    return { integrity_token: await playIntegrityToken(args.requestHash) };
  }
  if (DEV_SKIP_INTEGRITY) {
    console.warn('[integrity] DEV BYPASS: sending a placeholder instead of an App Attest assertion.');
    return { assertion: DEV_PLACEHOLDER_ATTESTATION };
  }
  if (!args.keyId) {
    // The credential is half-present: enrolled, but the key id is gone. Nothing
    // can be signed, and guessing would produce a punch with no proof behind it.
    throw new Error('This iPhone needs to be set up again.');
  }
  return { assertion: await signPunch(args.keyId, args.payload) };
}

/** Proof for setup. */
export async function requestSetupProof(args: {
  /** Android: the request hash. iOS: the exact payload string to attest. */
  androidRequestHash: string;
  iosChallenge: string;
}): Promise<SetupProof> {
  if (Platform.OS !== 'ios') {
    return { platform: 'android', integrity_token: await playIntegrityToken(args.androidRequestHash) };
  }
  if (DEV_SKIP_INTEGRITY) {
    console.warn('[integrity] DEV BYPASS: sending a placeholder instead of an App Attest attestation.');
    // The server generates the stand-in key under the same gate; the phone has no
    // key to report, so these are placeholders it will ignore.
    return { platform: 'ios', attestation: DEV_PLACEHOLDER_ATTESTATION, key_id: DEV_PLACEHOLDER_ATTESTATION };
  }
  const { attestation, keyId } = await attestNewKey(args.iosChallenge);
  return { platform: 'ios', attestation, key_id: keyId };
}

/**
 * Kept for the Android-only callers that still pass a request hash.
 * @deprecated Prefer requestPunchProof, which handles both platforms.
 */
export async function requestIntegrityToken(requestHash: string): Promise<string> {
  return playIntegrityToken(requestHash);
}
