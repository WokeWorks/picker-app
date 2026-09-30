import { useEffect, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricKind = 'face' | 'fingerprint';

// Which unlock this phone uses, so the app shows the matching icon and words.
// Face only when the phone has face unlock and no fingerprint sensor (e.g. an
// iPhone with Face ID); phones with both default to the fingerprint, which is
// what Android's strong-biometric prompt usually offers first.
//
// Looked up once per launch and remembered, so later screens show the right
// icon on their first frame; until the first answer arrives the hook returns
// null and callers draw nothing rather than a guess (no fingerprint flash).
let known: BiometricKind | null = null;
let pending: Promise<BiometricKind> | null = null;

function lookup(): Promise<BiometricKind> {
  pending ??= LocalAuthentication.supportedAuthenticationTypesAsync()
    .then((types) => {
      const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
      return (known = face && !finger ? 'face' : 'fingerprint');
    })
    .catch(() => (known = 'fingerprint'));
  return pending;
}

// Start as soon as the app loads, so the answer is usually ready before the
// first screen draws.
lookup();

export function useBiometricKind(): BiometricKind | null {
  const [kind, setKind] = useState<BiometricKind | null>(known);
  useEffect(() => {
    if (known) return;
    let mounted = true;
    lookup().then((k) => { if (mounted) setKind(k); });
    return () => { mounted = false; };
  }, []);
  return kind;
}

// A biometric prompt that did not approve. The person cancelling is silent;
// anything else (no face/fingerprint set up, locked out after failed tries, an
// app build that cannot use Face ID) gets a plain message, never a dead tap.
const SILENT = new Set(['user_cancel', 'system_cancel', 'app_cancel']);
export function biometricFailureMessage(result: { success: boolean; error?: string }): string | null {
  if (result.success || !result.error || SILENT.has(result.error)) return null;
  switch (result.error) {
    case 'not_enrolled': return 'No fingerprint or face unlock is set up on this phone. Use your phone passcode, or set one up in Settings.';
    // The lock screen now offers a passcode button when this fires, so the
    // message points at that rather than sending them out of the app.
    case 'lockout':
    case 'lockout_permanent': return 'Too many tries. Use your phone passcode instead.';
    case 'not_available':
    case 'missing_usage_description': return "This version of the app can't use Face ID or fingerprint. Ask your supervisor.";
    default: return "Your fingerprint or face wasn't confirmed. Try again.";
  }
}
