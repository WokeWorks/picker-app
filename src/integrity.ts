import { GOOGLE_CLOUD_PROJECT_NUMBER } from '@/native-api';

// Play Integrity token bound to `requestHash`. @expo/app-integrity is loaded
// lazily: Expo Go ships without its native module, and a top-level import
// crashes every screen that imports it. Loaded here, only registering or
// punching needs it, so the rest of the app can still be run in Expo Go.
// DEV ONLY. Google only vouches for builds it distributed, so `expo run:android`
// can never get a real token and neither setup nor punching can be tested on a
// developer machine. With this set, the app sends a placeholder instead and the
// SANDBOX server skips the Google check (see the server's mobile-dev-bypass.ts,
// which refuses to open against production). Everything else still runs: the
// biometric prompt, the one-time challenge, GPS and the geofence.
const DEV_SKIP_INTEGRITY = process.env.EXPO_PUBLIC_DEV_SKIP_INTEGRITY === '1';
const DEV_PLACEHOLDER_TOKEN = 'dev-bypass-no-play-integrity';

export async function requestIntegrityToken(requestHash: string): Promise<string> {
  if (DEV_SKIP_INTEGRITY) {
    console.warn('[integrity] DEV BYPASS: sending a placeholder instead of a Play Integrity token.');
    return DEV_PLACEHOLDER_TOKEN;
  }
  if (!GOOGLE_CLOUD_PROJECT_NUMBER) throw new Error('This build of the app is not configured. Ask your supervisor.');
  let AppIntegrity: typeof import('@expo/app-integrity');
  try {
    AppIntegrity = require('@expo/app-integrity');
  } catch {
    throw new Error('This needs the Play Store version of the app.');
  }
  await AppIntegrity.prepareIntegrityTokenProviderAsync(GOOGLE_CLOUD_PROJECT_NUMBER);
  return AppIntegrity.requestIntegrityCheckAsync(requestHash);
}
