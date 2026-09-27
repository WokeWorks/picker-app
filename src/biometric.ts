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
