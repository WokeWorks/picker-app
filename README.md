# OpsPro Picker

Native React Native/Expo app for picker clock-in and clock-out.

## Security model

- The phone's biometric system stays on-device. OpsPro never receives a face or fingerprint template.
- Only Android Class 3 biometrics or iOS biometrics are accepted; PIN/passcode fallback is disabled for punch approval.
- Each picker gets one registered phone with a device-bound signing key.
- The server issues a short-lived, one-time challenge for every punch.
- The app signs the exact picker, device, action, location and challenge payload after biometric approval.
- The existing OpsPro server remains authoritative for device status, roster, open-session state, GPS/geofence rules and clock events.
- App Attest (iOS) and Play Integrity (Android) must be verified server-side before a device becomes active.

Device biometrics prove that somebody enrolled on the phone approved an action. They do not prove which enrolled person it was. One-person phone control remains an operating requirement.

## Repository split

- This repository: native user interface, device enrollment, biometric gate and hardware-backed signing.
- `opspro-app`: API routes, Supabase migrations, attestation verification, challenge redemption and attendance writes.

## Current implementation

- Expo Router app shell
- strong-biometric capability preflight
- native biometric confirmation with device fallback disabled
- first-run enrollment-code interface
- server submission intentionally locked until the atomic backend enrollment and punch endpoints ship

## Local development

```sh
npm install
npx expo run:android
# or
npx expo run:ios
```

Use a real device and a development build for biometric testing. iOS Face ID is not available in Expo Go.

## Checks

```sh
npx tsc --noEmit
npx expo-doctor
npx expo export --platform android
```
