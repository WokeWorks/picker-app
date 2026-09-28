import { useEffect, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricKind = 'face' | 'fingerprint';

// Which unlock this phone uses, so the app shows the matching icon and words.
// Face only when the phone has face unlock and no fingerprint sensor (e.g. an
// iPhone with Face ID); phones with both default to the fingerprint, which is
// what Android's strong-biometric prompt usually offers first.
export function useBiometricKind(): BiometricKind {
  const [kind, setKind] = useState<BiometricKind>('fingerprint');
  useEffect(() => {
    let mounted = true;
    LocalAuthentication.supportedAuthenticationTypesAsync()
      .then((types) => {
        const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
        const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
        if (mounted) setKind(face && !finger ? 'face' : 'fingerprint');
      })
      .catch(() => {});
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
    case 'not_enrolled': return 'Set up fingerprint or face unlock in your phone settings, then try again.';
    case 'lockout': return 'Too many tries. Unlock your phone with its passcode, then try again.';
    case 'not_available':
    case 'missing_usage_description': return "This version of the app can't use Face ID or fingerprint. Ask your supervisor.";
    default: return "Your fingerprint or face wasn't confirmed. Try again.";
  }
}
