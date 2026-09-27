import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';

import { useBiometricKind } from '@/biometric';
import { Brand } from '@/components/Brand';
import { DEMO_STATES, demoSession, type DemoState } from '@/demo';
import { Icon } from '@/components/Icon';
import { requestIntegrityToken } from '@/integrity';
import { friendlyError } from '@/messages';
import { C } from '@/theme';
import { apiPost, INSTALL_SECRET_KEY } from '@/native-api';

type Session = {
  employee: { id: string; name: string };
  action: 'clock_in' | 'clock_out';
  clocked_in_at: string | null;
  locations: Array<{ id: string; name: string; shift_start: string; shift_end: string }>;
};

// Dubai time, 24h ("13:02"), whatever timezone the phone is set to.
function gstTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
}

export default function ClockScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Development-only preview with sample data (src/demo.ts).
  const params = useLocalSearchParams<{ demo?: string }>();
  const demo = __DEV__ && params.demo === '1';
  const [demoState, setDemoState] = useState<DemoState>('before');
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
      setDemoState(clockingIn ? 'on' : 'before');
      Alert.alert(clockingIn ? 'Clocked in' : 'Clocked out', `Recorded at ${gstTime(new Date().toISOString())}. (Preview: nothing was saved.)`);
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
      const done = await apiPost<{ timestamp: string }>('/api/mobile/punch/commit', { install_secret: installSecret, payload: challenge.payload, integrity_token: integrityToken });
      await refresh();
      Alert.alert(clockingIn ? 'Clocked in' : 'Clocked out', `Recorded at ${gstTime(done.timestamp)}.`);
    } catch (error) {
      Alert.alert(clockingIn ? 'Clock-in failed' : 'Clock-out failed', friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !session) {
    return <SafeAreaView style={styles.safe}><View style={styles.loading}><ActivityIndicator color={C.brand} size="large" /></View></SafeAreaView>;
  }

  const location = session?.locations[0];
  const onShift = session?.action === 'clock_out';
  const canPunch = !!session && session.locations.length === 1 && !busy;
  const firstName = session?.employee.name.split(' ')[0] || 'there';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={C.brand} colors={[C.brand]} />}
      >
        <Brand />

        {demo && (
          <View style={styles.demoBar}>
            <Text style={styles.demoLabel}>Preview with sample data</Text>
            <View style={styles.demoChips}>
              {DEMO_STATES.map((s) => (
                <Pressable key={s.id} onPress={() => setDemoState(s.id)} style={[styles.demoChip, demoState === s.id && styles.demoChipOn]}>
                  <Text style={[styles.demoChipText, demoState === s.id && styles.demoChipTextOn]}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <Text style={styles.hello}>Hi {firstName}</Text>
        <View style={[styles.statePill, onShift && styles.statePillOn]}>
          <View style={[styles.stateDot, onShift && styles.stateDotOn]} />
          <Text style={[styles.stateText, onShift && styles.stateTextOn]}>
            {onShift
              ? session?.clocked_in_at ? `Clocked in since ${gstTime(session.clocked_in_at)}` : 'Clocked in'
              : 'Not clocked in'}
          </Text>
        </View>

        <View style={styles.store}>
          <Icon name="pin" size={22} color={location ? C.brand : C.faint} />
          <View style={styles.storeCopy}>
            <Text style={styles.storeLabel}>{onShift ? 'Your store' : "Today's store"}</Text>
            <Text style={styles.storeName}>{location?.name || 'No shift right now'}</Text>
            {location
              ? <View style={styles.shiftRow}><Icon name="clock" size={15} color={C.muted} /><Text style={styles.shiftTime}>{location.shift_start} – {location.shift_end}</Text></View>
              : <Text style={styles.shiftTime}>Clock-in opens 90 minutes before your rostered start.</Text>}
          </View>
        </View>

        <View style={styles.actionZone}>
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
          <Text style={styles.punchHint}>Tap, then use your {bio === 'face' ? 'face' : 'fingerprint'}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(demo ? '/week?demo=1' : '/week')}
          style={({ pressed }) => [styles.weekCard, pressed && { backgroundColor: C.pressed }]}
        >
          <Icon name="clock" size={20} color={C.brand} />
          <Text style={styles.weekCardText}>Your shifts this week and next</Text>
          <Icon name="arrowRight" size={18} color={C.muted} />
        </Pressable>

        <View style={styles.checks}>
          <Icon name="checkCircle" size={16} color={C.muted} />
          <Text style={styles.checksText}>Your location and roster are checked with every punch</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  hello: { color: C.ink, fontSize: 32, fontWeight: '800', letterSpacing: -0.8, marginTop: 36 },
  statePill: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6,
  },
  statePillOn: { backgroundColor: C.greenBg, borderColor: '#A7E8BF' },
  stateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.faint },
  stateDotOn: { backgroundColor: C.green },
  stateText: { color: C.inkMid, fontSize: 14, fontWeight: '600' },
  stateTextOn: { color: C.green },
  store: {
    flexDirection: 'row', gap: 12, marginTop: 24, backgroundColor: C.paper,
    borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16,
  },
  storeCopy: { flex: 1 },
  storeLabel: { color: C.muted, fontSize: 13, fontWeight: '600' },
  storeName: { color: C.ink, fontSize: 20, fontWeight: '700', marginTop: 2 },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  shiftTime: { color: C.inkMid, fontSize: 15, marginTop: 2 },
  actionZone: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center' },
  punch: {
    width: 220, height: 220, borderRadius: 110, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 8, borderColor: C.brandTint,
  },
  punchPressed: { backgroundColor: C.brandDeep },
  punchOut: { backgroundColor: C.paper, borderColor: C.brand, borderWidth: 3 },
  punchOutPressed: { backgroundColor: C.brandTint },
  punchDisabled: { backgroundColor: C.line, borderColor: C.pressed, borderWidth: 8 },
  punchMain: { color: C.onBrand, fontSize: 26, fontWeight: '800' },
  punchMainOut: { color: C.brand },
  punchMainDisabled: { color: C.faint },
  punchHint: { color: C.muted, fontSize: 14, marginTop: 16 },
  demoBar: { marginTop: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: C.lineStrong, borderRadius: 12, padding: 10 },
  demoLabel: { color: C.muted, fontSize: 12, fontWeight: '600', marginBottom: 8 },
  demoChips: { flexDirection: 'row', gap: 6 },
  demoChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  demoChipOn: { backgroundColor: C.ink, borderColor: C.ink },
  demoChipText: { color: C.inkMid, fontSize: 12, fontWeight: '600' },
  demoChipTextOn: { color: C.paper },
  weekCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.paper,
    borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16, marginBottom: 16,
  },
  weekCardText: { flex: 1, color: C.ink, fontSize: 15, fontWeight: '600' },
  checks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  checksText: { color: C.muted, fontSize: 13 },
});
