import { GOOGLE_CLOUD_PROJECT_NUMBER } from '@/native-api';

// Play Integrity token bound to `requestHash`. @expo/app-integrity is loaded
// lazily: Expo Go ships without its native module, and a top-level import
// crashes every screen that imports it. Loaded here, only registering or
// punching needs it, so the rest of the app can still be run in Expo Go.
export async function requestIntegrityToken(requestHash: string): Promise<string> {
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
