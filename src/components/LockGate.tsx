import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, type AppStateStatus, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';

import { biometricFailureMessage, useBiometricKind } from '@/biometric';
import { Brand } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { isPrompting, isUnlocked, markLocked, requestUnlock } from '@/lock';
import { DEVICE_ID_KEY } from '@/native-api';
import { C } from '@/theme';

type Phase =
  | 'deciding'   // still finding out whether this phone is registered
  | 'open'       // no gate needed, or unlocked
  | 'locked';    // overlay up, waiting for a scan or a retry tap

/**
 * Requires a fingerprint/face scan before the app's contents can be seen or used.
 *
 * Only applies to a REGISTERED phone. An unregistered one must reach the setup
 * screen, and setup runs its own biometric check before it will enrol anything —
 * gating it here as well would leave a new phone unable to get past a lock screen
 * it has no way to satisfy.
 *
 * Children are always rendered, with the lock drawn OVER them as an opaque
 * layer, rather than swapped out. Replacing the navigator would tear down
 * expo-router's state on every lock, losing whichever screen the picker was on.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('deciding');
  const [message, setMessage] = useState<string | null>(null);
  const bio = useBiometricKind();
  /**
   * The last registration state that was actually READ successfully.
   *
   * Used only as the answer to "I don't know" when a later read throws -- never to
   * skip the read, which was the bug this whole gate had: a flag decided once on
   * mount meant a phone enrolling mid-session was never gated again.
   */
  const lastKnownRegistered = useRef(false);

  const unlock = useCallback(async () => {
    setMessage(null);
    try {
      const result = await requestUnlock();
      if (result.success) {
        setPhase('open');
        return;
      }
      // No passcode button is needed here: device fallback is always on, and the
      // native module drops to the phone's credential by itself when biometrics
      // are locked out or absent. A cancel is silent by design — the picker knows
      // they cancelled. Anything else gets the plain-English reason.
      setMessage(biometricFailureMessage(result));
    } catch {
      setMessage('The check could not run. Try again.');
    }
  }, []);

  // Decide on mount whether this phone is gated, and show the lock if it is.
  // Deliberately NOT cached for later use: the foreground handler below reads the
  // registration again each time. See the comment there.
  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync(DEVICE_ID_KEY)
      .then((deviceId) => {
        if (!mounted) return;
        lastKnownRegistered.current = !!deviceId;
        if (!deviceId) {
          setPhase('open');
          return;
        }
        setPhase('locked');
        void unlock();
      })
      .catch(() => {
        // SecureStore unavailable. Treat as unregistered and let the app decide
        // what to do rather than trapping the picker behind a lock screen: the
        // punch routes are the authority on whether this phone can do anything,
        // and they will refuse it without a secret.
        if (mounted) setPhase('open');
      });
    return () => { mounted = false; };
  }, [unlock]);

  // Re-lock when the app comes back from the background after the grace period.
  useEffect(() => {
    let cancelled = false;

    async function onChange(next: AppStateStatus) {
      // Cheap synchronous rejections first, before any await. Critical: the
      // native biometric sheet itself makes the app go inactive/background.
      // Without this guard the listener re-locks the app the moment it asks to
      // be unlocked, and prompts forever.
      if (isPrompting()) return;
      if (next !== 'active') return;
      if (isUnlocked()) return;

      // Read the registration FRESH every time, rather than caching what the
      // mount effect found. A phone that enrols during this session started out
      // unregistered, so a cached "not gated" would mean the lock never appears
      // again until the app is killed -- and that is the one session where it
      // matters most, because the phone has just become able to punch.
      let registered: boolean;
      try {
        registered = !!(await SecureStore.getItemAsync(DEVICE_ID_KEY));
        lastKnownRegistered.current = registered;
      } catch {
        // A read that THREW is "I don't know", not "not registered". Collapsing
        // those two into one branch meant a single unreadable keystore left the
        // app open for the rest of the run: every foreground after it skipped the
        // lock silently, with nothing to notice and no retry.
        //
        // This matters more than the "convenience gate" framing suggests. The
        // server flags a bad face match but does NOT refuse the punch (founder
        // decision, see api/mobile/punch/commit/route.ts), so whoever holds an
        // unlocked phone can complete a real punch that is only reviewed after
        // the fact. That makes this lock preventive, not cosmetic, so an unknown
        // answer stays locked.
        registered = lastKnownRegistered.current;
      }
      if (cancelled || !registered) return;
      // Re-check after the await: the picker may have unlocked, or a prompt may
      // have started, while SecureStore was being read.
      if (isPrompting() || isUnlocked()) return;

      markLocked();
      setPhase('locked');
      void unlock();
    }

    const sub = AppState.addEventListener('change', (next) => { void onChange(next); });
    return () => { cancelled = true; sub.remove(); };
  }, [unlock]);

  const locked = phase === 'locked' || phase === 'deciding';

  return (
    <View style={styles.root}>
      {children}
      {locked && (
        <SafeAreaView
          style={styles.cover}
          // Hides everything underneath from screen readers too, so the lock is
          // not merely a visual one.
          accessibilityViewIsModal
        >
          <View style={styles.inner}>
            <Brand />
            {phase === 'deciding' ? (
              <ActivityIndicator color={C.brand} />
            ) : (
              <>
                <View style={styles.badge}>
                  <Icon name={bio === 'face' ? 'face' : 'fingerprint'} size={34} color={C.brand} strokeWidth={2} />
                </View>
                <Text style={styles.title} accessibilityRole="header">
                  {bio === 'face' ? 'Use your face to open' : 'Use your fingerprint to open'}
                </Text>
                {message ? (
                  <Text style={styles.problem}>{message}</Text>
                ) : (
                  <Text style={styles.copy}>This keeps your shift and your hours to you.</Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                  onPress={() => void unlock()}
                  style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                  hitSlop={8}
                >
                  <Text style={styles.buttonText}>Try again</Text>
                </Pressable>
              </>
            )}
          </View>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Opaque and absolutely filling, so nothing behind it shows through — including
  // during the fade as a screen changes underneath.
  cover: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: C.canvas,
  },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 32 },
  badge: {
    width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandBorder,
  },
  title: { color: C.ink, fontSize: 22, fontWeight: '700', textAlign: 'center', letterSpacing: -0.3 },
  copy: { color: C.muted, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  problem: { color: C.danger, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  button: {
    marginTop: 4, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14,
    backgroundColor: C.brand, minWidth: 180, alignItems: 'center',
  },
  buttonPressed: { backgroundColor: C.brandDeep },
  buttonText: { color: C.onBrand, fontSize: 17, fontWeight: '700' },
});
