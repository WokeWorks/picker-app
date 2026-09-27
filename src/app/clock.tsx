import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';

import { useBiometricKind } from '@/biometric';
import { Brand } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { clockTime, duration, ShiftProgress } from '@/components/ShiftProgress';
import { EmptyCard, StoreCard } from '@/components/StoreCard';
import { DEMO_STATES, demoSession, type DemoState } from '@/demo';
import { requestIntegrityToken } from '@/integrity';
import { friendlyError } from '@/messages';
import { C } from '@/theme';
import { apiPost, INSTALL_SECRET_KEY } from '@/native-api';

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
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Development-only preview with sample data (src/demo.ts). The switcher can
  // be hidden to see the real layout; long-press the wordmark to bring it back.
  const params = useLocalSearchParams<{ demo?: string }>();
  const demo = __DEV__ && params.demo === '1';
  const [demoState, setDemoState] = useState<DemoState>('before');
  const [demoBar, setDemoBar] = useState(true);
  const bio = useBiometricKind();

  const refresh = useCallback(async () => {
    if (demo) { setSession(demoSession(demoState)); return; }
    const installSecret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
    if (!installSecret) throw new Error('device_inactive');
    setSession(await apiPost<Session>('/api/mobile/session', { install_secret: installSecret }));
  }, [demo, demoState]);

  const reload = useCallback(() => {
    setLoading(true);
    refresh().catch((error) => Alert.alert('Could not load your shift', friendlyError(error))).finally(() => setLoading(false));
  }, [refresh]);

  useEffect(reload, [reload]);

  async function punch() {
    if (!session || session.locations.length !== 1) return;
    const clockingIn = session.action === 'clock_in';
    if (demo) {
      const biometric = await LocalAuthentication.authenticateAsync({
        promptMessage: clockingIn ? 'Approve clock-in' : 'Approve clock-out',
        promptSubtitle: session.locations[0].name,
        disableDeviceFallback: true,
        requireConfirmation: true,
      });
      if (!biometric.success) return;
      setDemoState(clockingIn ? 'on' : 'done');
      return;
    }
    setBusy(true);
    try {
      const installSecret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
      if (!installSecret) throw new Error('device_inactive');
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Allow location access in your phone settings, then try again.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (position.mocked === true) throw new Error('mock_location_detected');
      if ((position.coords.accuracy ?? Infinity) > 100) throw new Error('poor_gps_accuracy');

      const biometric = await LocalAuthentication.authenticateAsync({
        promptMessage: clockingIn ? 'Approve clock-in' : 'Approve clock-out',
        promptSubtitle: session.locations[0].name,
        disableDeviceFallback: true,
        biometricsSecurityLevel: 'strong',
        requireConfirmation: true,
      });
      if (!biometric.success) return;

      const challenge = await apiPost<{ payload: string; request_hash: string }>('/api/mobile/punch/challenge', {
        install_secret: installSecret,
        location_id: session.locations[0].id,
        action: session.action,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        gps_accuracy: position.coords.accuracy,
        location_mocked: false, // a mocked position is refused above, before any request
      });
      const integrityToken = await requestIntegrityToken(challenge.request_hash);
      await apiPost('/api/mobile/punch/commit', { install_secret: installSecret, payload: challenge.payload, integrity_token: integrityToken });
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
      const installSecret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
      if (!installSecret) throw new Error('device_inactive');
      await apiPost('/api/mobile/break', { install_secret: installSecret, action });
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
    return <SafeAreaView style={styles.safe}><View style={styles.loading}><ActivityIndicator color={C.brand} size="large" /></View></SafeAreaView>;
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
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={C.brand} colors={[C.brand]} />}
      >
        <View style={styles.header}>
          <Brand onLongPress={demo ? () => setDemoBar(true) : undefined} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your shift schedule"
            onPress={() => router.push(demo ? '/week?demo=1' : '/week')}
            style={({ pressed }) => [styles.scheduleBtn, pressed && { backgroundColor: C.pressed }]}
            hitSlop={6}
          >
            <Icon name="calendar" size={17} color={C.brand} strokeWidth={2} />
            <Text style={styles.scheduleText}>Schedule</Text>
          </Pressable>
        </View>

        {demo && demoBar && (
          <View style={styles.demoBar}>
            <View style={styles.demoHead}>
              <Text style={styles.demoLabel}>Preview with sample data</Text>
              <Pressable onPress={() => setDemoBar(false)} hitSlop={8}>
                <Text style={styles.demoHide}>Hide</Text>
              </Pressable>
            </View>
            <View style={styles.demoChips}>
              {DEMO_STATES.map((s) => (
                <Pressable key={s.id} onPress={() => setDemoState(s.id)} style={[styles.demoChip, demoState === s.id && styles.demoChipOn]}>
                  <Text style={[styles.demoChipText, demoState === s.id && styles.demoChipTextOn]}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.demoTip}>After hiding, long-press "OpsPro Picker" to bring this back.</Text>
          </View>
        )}

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
          <View style={styles.donePanel}>
            <View style={styles.doneHead}>
              <Icon name="checkCircle" size={20} color={C.brand} strokeWidth={2} />
              <Text style={styles.doneLabel}>Shift done</Text>
            </View>
            <Text style={styles.doneBig}>
              {duration(Date.parse(session.done_today.clock_out) - Date.parse(session.done_today.clock_in))}
            </Text>
            <Text style={styles.doneMeta}>
              {clockTime(Date.parse(session.done_today.clock_in))} – {clockTime(Date.parse(session.done_today.clock_out))}
            </Text>
          </View>
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
                  <Icon name={bio} size={44} color={!canPunch ? C.faint : onShift ? C.brand : C.onBrand} strokeWidth={1.6} />
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
              <Text style={styles.punchHint}>Tap, then use your {bio === 'face' ? 'face' : 'fingerprint'}</Text>
            )}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  hello: { color: C.ink, fontSize: 32, fontWeight: '800', letterSpacing: -0.8, marginTop: 28 },
  gap: { marginTop: 16 },
  donePanel: { marginTop: 16, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandBorder, borderRadius: 16, padding: 18 },
  doneHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  doneLabel: { color: C.brand, fontSize: 13, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  doneBig: { color: C.ink, fontSize: 40, fontWeight: '800', letterSpacing: -1, marginTop: 4 },
  doneMeta: { color: C.inkMid, fontSize: 15, marginTop: 2 },
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
  demoBar: { marginTop: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: C.lineStrong, borderRadius: 12, padding: 10 },
  demoHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  demoLabel: { color: C.muted, fontSize: 12, fontWeight: '600' },
  demoHide: { color: C.brand, fontSize: 12, fontWeight: '700' },
  demoChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  demoChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  demoChipOn: { backgroundColor: C.ink, borderColor: C.ink },
  demoChipText: { color: C.inkMid, fontSize: 12, fontWeight: '600' },
  demoChipTextOn: { color: C.paper },
  demoTip: { color: C.faint, fontSize: 11, marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scheduleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 99, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line,
  },
  scheduleText: { color: C.brand, fontSize: 14, fontWeight: '700' },
});
