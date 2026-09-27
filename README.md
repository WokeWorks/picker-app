# OpsPro Picker

Native React Native/Expo app for picker clock-in and clock-out.

## Security model

What is implemented today (Android):

- The phone's biometric system stays on-device. OpsPro never receives a face or fingerprint template.
- The app only proceeds after a Class 3 (strong) biometric prompt, with PIN/passcode fallback disabled. This is enforced by the app itself; the server does not receive proof that the prompt ran.
- Each picker has one active registered phone. Registration uses a one-time, 15-minute setup code issued by an admin.
- The phone holds a random install secret in SecureStore. Every request presents it, so it acts as the device credential.
- Every punch uses a short-lived, single-use server challenge. The exact punch payload (picker device, action, store, GPS) is bound to a Google Play Integrity token that the server verifies: genuine OpsPro build from Play, genuine device, licensed.
- The server (`opspro-app`) stays authoritative for device status, roster window, open session, geofence and the clock event.
- Admins can revoke a lost or compromised phone (`POST /api/mobile/devices/revoke`).

Known limits:

- Device biometrics prove that someone enrolled on the phone approved the punch, not which person. Anyone whose fingerprint is added to the phone can punch. One-person phone control is an operating rule, not a technical control.
- The mock-location flag comes from the phone, so it only catches an unmodified app.
- Not yet built: a hardware-backed signing key that only unlocks with biometrics (Android Keystore + Key Attestation) and signs each punch. That is what would give the server proof of the biometric approval and of this exact phone.
- iOS enrollment stays fail-closed until the App Attest verifier ships.

## Repository split

- This repository: native user interface, device enrollment and the biometric prompt (hardware-backed signing is planned, see above).
- `opspro-app`: API routes, Supabase migrations, attestation verification, challenge redemption and attendance writes.

## Current implementation

- Expo Router app shell
- strong-biometric capability preflight
- native biometric confirmation with device fallback disabled
- first-run enrollment-code interface
- enrollment and punch submission wired to the `opspro-app` mobile endpoints

## Local development

```sh
npm install
npx expo run:android
# or
npx expo run:ios
```

Use a real device and a development build for biometric testing. iOS Face ID is not available in Expo Go.

Set these build-time values before producing the Android development build:

```sh
EXPO_PUBLIC_API_BASE_URL=https://your-backend.example
EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER=123456789012
```

Android integrity requires a Play-distributed build and the matching Play Integrity configuration. iOS enrollment remains fail-closed until the App Attest server verifier ships.

## Checks

```sh
npx tsc --noEmit
npx expo-doctor
npx expo export --platform android
```
