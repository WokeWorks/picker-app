import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';

import { BottomNav, useBottomNavPadding } from '@/components/BottomNav';
import { Brand } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { ShiftProgress } from '@/components/ShiftProgress';
import { DonePanel } from '@/components/DonePanel';
import { EmptyCard, StoreCard } from '@/components/StoreCard';
import { demoSession, type DemoState } from '@/demo';
import { CameraSheet } from '@/components/CameraSheet';
import { requestPunchProof } from '@/integrity';
import { registerForReminders } from '@/notifications';
import { friendlyError, isDeregistered, isDeregisteredStuck } from '@/messages';
import { takeNavDirection } from '@/nav-direction';
import { C } from '@/theme';
import { apiPost, apiPostFile, INSTALL_SECRET_KEY, readAppAttestKeyId, requireInstallSecret } from '@/native-api';

type Store = { name: string; chain?: string | null; area?: string | null; lat: number | null; lng: number | null };

type Session = {
  employee: { id: string; name: string };
  action: 'clock_in' | 'clock_out';
  clocked_in_at: string | null;
  locations: Array<Store & { id: string; shift_start: string; shift_end: string }>;
  break?: { on_break: boolean; break_used: boolean; started_at: string | null; ended_at: string | null } | null;
  done_today?: { clock_in: string; clock_out: string } | null;
  next_shift?: (Store & { date: string; start: string; end: string }) | null;
};

// The card label for the next shift, like "Today's store": "Tomorrow", then
// "In 2 days", "In 3 days"... (Dubai calendar days).
function dayLabel(iso: string) {
  const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

export default function ClockScreen() {
  const navPad = useBottomNavPadding();
  // Taken ONCE as this screen mounts, not on every render: re-reading mid
  // transition would change the animation under it. See src/nav-direction.ts.
  const [navAnimation] = useState(takeNavDirection);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Development-only preview with sample data (src/demo.ts): starts before the
  // shift, and the buttons move it through clock in, break and clock out.
  const params = useLocalSearchParams<{ demo?: string }>();
  const demo = __DEV__ && params.demo === '1';
  const [demoState, setDemoState] = useState<DemoState>('before');

  const refresh = useCallback(async () => {
    if (demo) { setSession(demoSession(demoState)); return; }
    const installSecret = await requireInstallSecret();
    setSession(await apiPost<Session>('/api/mobile/session', { install_secret: installSecret }));
  }, [demo, demoState]);

  const reload = useCallback(() => {
    setLoading(true);
    refresh()
      .catch((error) => {
        // apiPost has already cleared the credential AND navigated to setup, so
        // there is nothing to do but stay quiet. Alerting would put a box over the
        // setup screen about a shift that is no longer this phone's business.
        if (isDeregistered(error)) return;
        // The one case that did NOT navigate, because it could not: the keystore
        // refused to give up the credential, so '/' would bounce straight back
        // here. Say so instead of looping.
        if (isDeregisteredStuck(error)) {
          Alert.alert('This phone has been removed', friendlyError(error));
          return;
        }
        Alert.alert('Could not load your shift', friendlyError(error));
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(reload, [reload]);

  // Re-read every time this screen is focused, not just on mount: coming back from
  // the inbox after reading everything used to leave the badge showing the old
  // count until the next reload.
  const refreshBadge = useCallback(() => {
    if (demo) return;
    let mounted = true;
    SecureStore.getItemAsync(INSTALL_SECRET_KEY)
      .then((secret) => (secret
        ? apiPost<{ unread: number }>('/api/mobile/notifications', { install_secret: secret, before: null })
        : null))
      .then((r) => { if (mounted && r) setUnread(r.unread); })
      .catch(() => { /* the badge is not worth an error in front of a picker */ });
    return () => { mounted = false; };
  }, [demo]);

  useFocusEffect(refreshBadge);

  // Once per launch on a registered phone: ask for notification permission and
  // register for shift reminders. Not in the preview (no real phone behind it).
  useEffect(() => {
    if (demo) return;
    SecureStore.getItemAsync(INSTALL_SECRET_KEY).then((secret) => {
      if (secret) registerForReminders(secret);
    });
  }, [demo]);

  // Opens the camera and resolves with the photo, or null if they backed out.
  // Kept as a promise so punch() stays a straight line instead of a state machine
  // spread across callbacks.
  const selfieResolver = useRef<((uri: string | null) => void) | null>(null);
  const [selfieOpen, setSelfieOpen] = useState(false);
  // Unread badge. Its own small request rather than part of the session payload,
  // so a notifications outage can never stop the clock screen loading — the thing
  // pickers actually need it for.
  const [unread, setUnread] = useState(0);
  function askForSelfie(): Promise<string | null> {
    return new Promise((resolve) => {
      selfieResolver.current = resolve;
      setSelfieOpen(true);
    });
  }

  function finishSelfie(uri: string | null) {
    setSelfieOpen(false);
    selfieResolver.current?.(uri);
    selfieResolver.current = null;
  }

  async function punch() {
    if (!session || session.locations.length !== 1) return;
    const clockingIn = session.action === 'clock_in';

    // NO fingerprint prompt here any more. It used to be the only identity check
    // in the punch path; the photo replaces it, and is far stronger — the
    // fingerprint only ever proved "somebody enrolled on this phone", whereas the
    // server compares the face to the picker's reference photo. The fingerprint
    // now guards OPENING the app (src/lock.ts), which is where it earns its keep.
    // Two prompts, each doing something the other cannot.
    if (demo) {
      const shot = await askForSelfie();
      if (!shot) return;
      setDemoState(clockingIn ? 'on' : 'done');
      return;
    }
    setBusy(true);
    try {
      const installSecret = await requireInstallSecret();
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Allow location access in your phone settings, then try again.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (position.mocked === true) throw new Error('mock_location_detected');
      if ((position.coords.accuracy ?? Infinity) > 100) throw new Error('poor_gps_accuracy');

      // Location is checked BEFORE the camera on purpose: being told to move
      // closer to the store after posing for a photo is a worse experience than
      // being told before.
      const selfieUri = await askForSelfie();
      if (!selfieUri) return;

      const challenge = await apiPost<{ payload: string; request_hash: string }>('/api/mobile/punch/challenge', {
        install_secret: installSecret,
        location_id: session.locations[0].id,
        action: session.action,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        gps_accuracy: position.coords.accuracy,
        location_mocked: false, // a mocked position is refused above, before any request
      });
      // iOS signs challenge.payload itself; Android proves against its hash. Both
      // come from the same challenge response, so neither can drift from what the
       // server will recompute.
      const proof = await requestPunchProof({
        payload: challenge.payload,
        requestHash: challenge.request_hash,
        keyId: await readAppAttestKeyId(),
      });
      await apiPostFile('/api/mobile/punch/commit', {
        install_secret: installSecret,
        payload: challenge.payload,
        ...proof,
      }, selfieUri);
      await refresh();
    } catch (error) {
      Alert.alert(clockingIn ? 'Clock-in failed' : 'Clock-out failed', friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function setBreak(action: 'start' | 'end') {
    if (demo) { setDemoState(action === 'start' ? 'break' : 'on'); return; }
    setBusy(true);
    try {
      const installSecret = await requireInstallSecret();
      await apiPost('/api/mobile/break', { install_secret: installSecret, action }, { timeoutMs: 45_000 });
      await refresh();
    } catch (error) {
      Alert.alert(action === 'start' ? 'Could not start your break' : 'Could not end your break', friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmStartBreak() {
    Alert.alert(
      'Start your break?',
      'Your break is 1 hour and you get one per shift. It ends by itself after the hour, or you can end it early.',
      [{ text: 'Not now', style: 'cancel' }, { text: 'Start break', onPress: () => setBreak('start') }],
    );
  }

  if (loading && !session) {
    // The option goes on THIS branch too. React Navigation reads it from whatever
    // the screen rendered first, and arriving here while still loading would
    // otherwise fall back to the stack default and slide in from the wrong side.
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ animation: navAnimation }} />
        <View style={styles.loading}><ActivityIndicator color={C.brand} size="large" /></View>
      </SafeAreaView>
    );
  }

  const location = session?.locations[0];
  const onShift = session?.action === 'clock_out';
  const onBreak = onShift && !!session?.break?.on_break;
  const breakUsed = !!session?.break?.break_used;
  const done = !onShift && !!session?.done_today;
  const canPunch = !!session && session.locations.length === 1 && !busy;
  const firstName = session?.employee.name.split(' ')[0] || 'there';
  const next = session?.next_shift;

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ animation: navAnimation }} />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingBottom: navPad }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={C.brand} colors={[C.brand]} />}
      >
        <View style={styles.header}>
          {/* The only element that may shrink: the three controls are fixed-size
              targets and must stay tappable. */}
          <View style={styles.brandShrink}><Brand /></View>
          {/* Schedule and notifications now live in the bar at the bottom. Profile
              stays here: it is a destination rather than a place to live, and the
              top-right corner is where it has always been. Dropping two buttons
              from this row also ends the narrow-phone clipping that used to make
              the profile button vanish entirely on a 320dp screen. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your details and documents"
            onPress={() => router.push('/profile')}
            style={({ pressed }) => [styles.bellBtn, pressed && { backgroundColor: C.pressed }]}
            hitSlop={6}
          >
            <Icon name="person" size={18} color={C.brand} strokeWidth={2} />
          </Pressable>
        </View>


        <Text style={styles.hello}>Hi {firstName}!</Text>

        {onShift && session?.clocked_in_at && (
          <ShiftProgress
            clockedInAt={session.clocked_in_at}
            shiftStart={location?.shift_start}
            shiftEnd={location?.shift_end}
            breakStartedAt={onBreak ? session.break?.started_at : null}
          />
        )}

        {done && session?.done_today && (
          <DonePanel clockIn={session.done_today.clock_in} clockOut={session.done_today.clock_out} />
        )}

        {location ? (
          <StoreCard
            label={onShift ? 'Your store' : "Today's store"}
            store={location}
            start={location.shift_start}
            end={location.shift_end}
            style={styles.gap}
          />
        ) : !done ? (
          <EmptyCard
            title="No shift right now"
            note="Clock-in opens 90 minutes before your rostered start."
            style={styles.gap}
          />
        ) : null}

        {!onShift && !location && next && (
          <StoreCard label={dayLabel(next.date)} store={next} start={next.start} end={next.end} style={styles.gap} />
        )}

        {/* No clock button when there is nothing to clock into (shift done, or no
            shift open right now) rather than a greyed-out one. */}
        {!done && (onShift || !!location) && (
          <View style={styles.actionZone}>
            {onBreak ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy }}
                disabled={busy}
                onPress={() => setBreak('end')}
                style={({ pressed }) => [styles.punch, styles.punchBreak, pressed && styles.punchBreakPressed]}
              >
                {busy ? <ActivityIndicator color={C.onOrange} size="large" /> : <>
                  <Icon name="tea" size={42} color={C.onOrange} strokeWidth={1.6} />
                  <Text style={[styles.punchMain, styles.punchMainBreak]}>End break</Text>
                </>}
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={onShift ? 'Clock out' : 'Clock in'}
                accessibilityState={{ disabled: !canPunch, busy }}
                disabled={!canPunch}
                onPress={punch}
                style={({ pressed }) => [
                  styles.punch,
                  onShift && styles.punchOut,
                  !canPunch && styles.punchDisabled,
                  pressed && canPunch && (onShift ? styles.punchOutPressed : styles.punchPressed),
                ]}
              >
                {busy ? <ActivityIndicator color={onShift ? C.brand : C.onBrand} size="large" /> : <>
                  {/* A camera, not a fingerprint: the punch now asks for a photo.
                      Promising a fingerprint here would be a lie about what the
                      next tap does. */}
                  <Icon name="face" size={44} color={!canPunch ? C.faint : onShift ? C.brand : C.onBrand} strokeWidth={1.6} />
                  <Text style={[styles.punchMain, onShift && styles.punchMainOut, !canPunch && styles.punchMainDisabled]}>
                    {onShift ? 'Clock out' : 'Clock in'}
                  </Text>
                </>}
              </Pressable>
            )}

            {onBreak ? (
              <Pressable accessibilityRole="button" onPress={punch} disabled={!canPunch} style={styles.secondary} hitSlop={6}>
                <Text style={styles.secondaryText}>Clock out instead</Text>
              </Pressable>
            ) : onShift && !breakUsed ? (
              <Pressable accessibilityRole="button" onPress={confirmStartBreak} disabled={busy} style={({ pressed }) => [styles.breakBtn, pressed && { backgroundColor: C.orangeDeep }]}>
                <Icon name="tea" size={19} color={C.onOrange} />
                <Text style={styles.breakBtnText}>Take a break</Text>
              </Pressable>
            ) : onShift ? (
              <Text style={styles.punchHint}>Break taken</Text>
            ) : (
              <Text style={styles.punchHint}>Tap, then take a photo of your face</Text>
            )}
          </View>
        )}

      </ScrollView>

      <BottomNav unread={unread} />
      {/* Stays mounted and driven by `visible`, rather than being conditionally
          rendered. RN's Modal keeps itself rendered after visible goes false
          purely so it can animate out, so unmounting it here would take the
          dismiss animation with it. Capture state is reset on every exit path
          inside the sheet instead -- see the finally in CameraSheet.take(). */}
      <CameraSheet
        visible={selfieOpen}
        // The sheet can only be open because punch() opened it, and punch()
        // returns early without a session -- but nothing in the types says so.
        action={session?.action === 'clock_out' ? 'clock_out' : 'clock_in'}
        onCapture={(uri) => finishSelfie(uri)}
        onCancel={() => finishSelfie(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  hello: { color: C.ink, fontSize: 32, fontWeight: '800', letterSpacing: -0.8, marginTop: 28 },
  gap: { marginTop: 16 },
  actionZone: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  punch: {
    width: 220, height: 220, borderRadius: 110, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 8, borderColor: C.brandTint,
  },
  punchPressed: { backgroundColor: C.brandDeep },
  punchOut: { backgroundColor: C.paper, borderColor: C.brand, borderWidth: 3 },
  punchOutPressed: { backgroundColor: C.brandTint },
  punchBreak: { backgroundColor: C.orange, borderColor: C.orangeTint },
  punchBreakPressed: { backgroundColor: C.orangeDeep },
  punchDisabled: { backgroundColor: C.line, borderColor: C.pressed, borderWidth: 8 },
  punchMain: { color: C.onBrand, fontSize: 26, fontWeight: '800' },
  punchMainOut: { color: C.brand },
  punchMainBreak: { color: C.onOrange },
  punchMainDisabled: { color: C.faint },
  punchHint: { color: C.muted, fontSize: 14, marginTop: 16 },
  breakBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 99, backgroundColor: C.orange,
  },
  breakBtnText: { color: C.onOrange, fontSize: 15, fontWeight: '700' },
  secondary: { marginTop: 18, paddingVertical: 8, paddingHorizontal: 12 },
  secondaryText: { color: C.brand, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' },
  // gap, and children allowed to shrink: the row holds four things now, and
  // space-between alone let them collide rather than tighten.
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  bellBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.line, backgroundColor: C.paper,
  },
  brandShrink: { flexShrink: 1, minWidth: 0 },
});
