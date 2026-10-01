# OpsPro Picker

> **Handoff:** the full status, decisions, go-live steps and open items are in
> `MOBILE-HANDOFF.md` on the dashboard repo (`OpsBro-pro-max/app`, branch
> `mobile/0049-per-day-rules`). v1 is Android only. Build native from outside
> iCloud-synced folders (Xcode signing fails in `~/Documents`).

Native React Native/Expo app for picker clock-in and clock-out.

## Security model

What is implemented today (Android):

- **Identity on a punch is proved by a face check on the SERVER.** Clocking in or
  out takes a selfie, which is uploaded and compared to the picker's reference
  photo by the same code the wall kiosk uses (`describeFace` then `faceGate`). The
  phone never measures the face and is never asked to: a verdict from a device the
  picker controls is worth nothing.
- The phone's own fingerprint/face unlock is used to OPEN the app, replacing typing
  a mobile number. It is a convenience gate, not a punch-path control — the server
  does not receive, and does not rely on, proof that it ran.
- The phone's biometric system stays on-device. OpsPro never receives a fingerprint
  or face template from it. (The punch selfie is an ordinary photo, stored in the
  `selfies` bucket, the same as a kiosk punch.)
- Each picker has one active registered phone. Registration uses a one-time, 15-minute setup code issued by an admin.
- The phone holds a random install secret in SecureStore. Every request presents it, so it acts as the device credential.
- Every punch uses a short-lived, single-use server challenge. The exact punch payload (picker device, action, store, GPS) is bound to a Google Play Integrity token that the server verifies: genuine OpsPro build from Play, genuine device, licensed.
- The server (`opspro-app`) stays authoritative for device status, roster window, open session, geofence and the clock event.
- Admins can revoke a lost or compromised phone (`POST /api/mobile/devices/revoke`).

Known limits:

- A bad face match does NOT stop a punch. It is recorded, flagged, and an alert is
  raised on the first one (the kiosk refuses instead, after three). Founder
  decision, 2026-09-29. This only works as a control if somebody actually reviews
  the flags — the selfie is stored so there is something to look at.
- A picker with no reference photo on file flags on EVERY punch, by design, so that
  nothing passes unchecked and silently.
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
