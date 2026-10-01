import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, type AppStateStatus, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { biometricFailureMessage, useBiometricKind } from '@/biometric';
import { Brand } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { hasBeenAway, isPrompting, isUnlocked, markLeft, markLocked, markReturned, requestUnlock } from '@/lock';
import { isEnrolled, readEnrolment } from '@/native-api';
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
    // BOTH keys, matching index.tsx exactly. Gating on either one alone makes the
    // two disagree: on the device id, the picker unlocks their way to a screen
    // that only tells them to get a new setup code; on the secret, a phone index
    // has already sent to setup still gets an unlock wall in front of it.
    readEnrolment()
      .then((enrolment) => {
        if (!mounted) return;
        const registered = isEnrolled(enrolment);
        // Only recorded when the read actually WORKED. An unreadable keystore must
        // not be remembered as "not registered", or the first foreground after it
        // would fall back to that wrong answer and leave the phone ungated for the
        // rest of the session.
        if (enrolment.ok) lastKnownRegistered.current = registered;
        if (!registered) {
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

  // The cover's own state, readable from the AppState handler without making the
  // effect depend on it. Used to answer one question: is the lock ALREADY up?
  //
  // Written in an effect rather than during render: assigning to a ref while
  // rendering is what the react-hooks rule objects to, and it is the kind of
  // thing that stops being true under concurrent rendering.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Re-lock when the app comes back from the BACKGROUND after the grace period.
  useEffect(() => {
    let cancelled = false;

    async function onChange(next: AppStateStatus) {
      if (next === 'background') {
        // Starts the grace clock, and deliberately runs even while a prompt is on
        // screen: a prompt that backgrounds the app and then SUCCEEDS clears this
        // anyway, while one that is cancelled leaves it set, which is correct --
        // the app really is away. Skipping it here was how a Home press landing
        // on a successful unlock left the app unlocked indefinitely.
        markLeft();
        return;
      }
      if (next !== 'active') return;

      // The native biometric sheet backgrounds the app itself. Without this the
      // listener re-locks the instant it asks to unlock, and prompts forever.
      if (isPrompting()) return;

      // ALREADY locked: the cover is up and the picker has a Try again button.
      // Without this, cancelling a prompt on any Android that pauses the activity
      // re-locked and re-prompted the moment the activity resumed -- so the
      // cancel button could never be used. The isPrompting guard above does not
      // catch it, because by then the prompt has already resolved.
      if (phaseRef.current === 'locked') return;

      // Nothing to judge: the app never actually went away. This replaces
      // tracking the previous AppState, which was redundant -- leftAt already
      // records a real absence, and deriving it from the state machine would have
      // forgiven a genuine one on any platform that inserted 'inactive' on the
      // way back.
      if (!hasBeenAway()) return;

      if (isUnlocked()) {
        // Inside the grace. Stop the clock so this trip is not charged again.
        markReturned();
        return;
      }

      // Read the registration FRESH rather than caching what the mount effect
      // found. A phone that enrols during this session started out unregistered,
      // so a cached "not gated" would mean the lock never appears again until the
      // app is killed -- the one session where it matters most, because the phone
      // has just become able to punch.
      // A read that THREW is "I don't know", not "not registered" -- readEnrolment
      // reports that as ok:false rather than hiding it behind a null. Falling back
      // to the last known state means a phone we have seen registered stays gated
      // through a transient keystore error, instead of silently opening.
      const enrolment = await readEnrolment();
      const registered = enrolment.ok ? isEnrolled(enrolment) : lastKnownRegistered.current;
      if (enrolment.ok) lastKnownRegistered.current = registered;
      if (cancelled || !registered) {
        markReturned();
        return;
      }
      // Re-checked after the await: the picker may have unlocked, or a prompt may
      // have started, while SecureStore was being read. The phase is deliberately
      // NOT re-checked -- it was checked above and only this function sets it to
      // 'locked', so a second test is dead code that TypeScript correctly refuses
      // to believe.
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
