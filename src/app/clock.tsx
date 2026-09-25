import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import * as AppIntegrity from '@expo/app-integrity';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';

import { C } from '@/theme';
import { apiPost, GOOGLE_CLOUD_PROJECT_NUMBER, INSTALL_SECRET_KEY } from '@/native-api';

type Session = {
  employee: { id: string; name: string };
  action: 'clock_in' | 'clock_out';
  clocked_in_at: string | null;
  locations: Array<{ id: string; name: string; shift_start: string; shift_end: string }>;
};

export default function ClockScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(true);

  const refresh = useCallback(async () => {
    const installSecret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
    if (!installSecret) throw new Error('This phone is not enrolled.');
    setSession(await apiPost<Session>('/api/mobile/session', { install_secret: installSecret }));
  }, []);

  useEffect(() => {
    refresh().catch((error) => Alert.alert('Could not load shift', error.message)).finally(() => setBusy(false));
  }, [refresh]);

  async function punch() {
    if (!session || session.locations.length !== 1) return;
    setBusy(true);
    try {
      if (!GOOGLE_CLOUD_PROJECT_NUMBER) throw new Error('Play Integrity project is not configured in this build.');
      const installSecret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
      if (!installSecret) throw new Error('This phone is not enrolled.');
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Location permission is required.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (position.mocked === true) throw new Error('Mock location is enabled.');
      if ((position.coords.accuracy ?? Infinity) > 100) throw new Error('GPS is not accurate enough. Move near the entrance and retry.');

      const biometric = await LocalAuthentication.authenticateAsync({
        promptMessage: session.action === 'clock_in' ? 'Approve clock-in' : 'Approve clock-out',
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
        location_mocked: false,
      });
      await AppIntegrity.prepareIntegrityTokenProviderAsync(GOOGLE_CLOUD_PROJECT_NUMBER);
      const integrityToken = await AppIntegrity.requestIntegrityCheckAsync(challenge.request_hash);
      await apiPost('/api/mobile/punch/commit', { install_secret: installSecret, payload: challenge.payload, integrity_token: integrityToken });
      await refresh();
      Alert.alert(session.action === 'clock_in' ? 'Clocked in' : 'Clocked out', 'Your punch was verified.');
    } catch (error) {
      Alert.alert('Punch failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (busy && !session) return <SafeAreaView style={styles.safe}><View style={styles.loading}><ActivityIndicator color={C.tealDark} size="large" /></View></SafeAreaView>;

  const location = session?.locations[0];
  const canPunch = !!session && session.locations.length === 1 && !busy;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.topline}><Text style={styles.brand}>OpsPro</Text><Text style={styles.secure}>SECURE DEVICE</Text></View>
        <Text style={styles.hello}>Hi, {session?.employee.name.split(' ')[0] || 'Picker'}.</Text>
        <Text style={styles.state}>{session?.action === 'clock_out' ? 'You’re on shift.' : 'Ready for work?'}</Text>
        <View style={styles.storeBand}>
          <Text style={styles.storeLabel}>TODAY’S STORE</Text>
          <Text style={styles.storeName}>{location?.name || 'No open shift right now'}</Text>
          {location && <Text style={styles.shiftTime}>{location.shift_start} — {location.shift_end}</Text>}
        </View>
        <View style={styles.actionZone}>
          <Pressable accessibilityRole="button" disabled={!canPunch} onPress={punch}
            style={({ pressed }) => [styles.punch, !canPunch && styles.punchDisabled, pressed && styles.punchPressed]}>
            {busy ? <ActivityIndicator color={C.ink} /> : <>
              <Text style={styles.punchSmall}>BIOMETRIC APPROVAL</Text>
              <Text style={styles.punchMain}>{session?.action === 'clock_out' ? 'Clock out' : 'Clock in'}</Text>
              <Text style={styles.punchHint}>Tap, then use fingerprint or face</Text>
            </>}
          </Pressable>
        </View>
        <View style={styles.trustRow}><Text style={styles.trustDot}>●</Text><Text style={styles.trustText}>Device, location and roster will be verified</Text></View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { flex: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 },
  topline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: C.ink, fontSize: 20, fontWeight: '900' },
  secure: { color: C.tealDark, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }, hello: { color: C.muted, fontSize: 18, marginTop: 54 },
  state: { color: C.ink, fontSize: 42, lineHeight: 47, fontWeight: '800', letterSpacing: -1.6, marginTop: 5 },
  storeBand: { marginTop: 34, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 20 },
  storeLabel: { color: C.tealDark, fontSize: 10, fontWeight: '800', letterSpacing: 1.8 }, storeName: { color: C.ink, fontSize: 23, fontWeight: '800', marginTop: 7 },
  shiftTime: { color: C.muted, fontSize: 15, marginTop: 5 }, actionZone: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  punch: { width: 250, height: 250, borderRadius: 125, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center', padding: 24, borderWidth: 10, borderColor: C.tealTint },
  punchDisabled: { backgroundColor: '#CCD6D4', borderColor: '#EEF2F1' }, punchPressed: { transform: [{ scale: 0.97 }] },
  punchSmall: { color: C.tealDark, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }, punchMain: { color: C.ink, fontSize: 34, fontWeight: '900', marginTop: 8 },
  punchHint: { color: C.ink, opacity: 0.7, textAlign: 'center', fontSize: 12, lineHeight: 17, marginTop: 8 },
  trustRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }, trustDot: { color: C.tealDark, fontSize: 10 }, trustText: { color: C.muted, fontSize: 12 },
});
