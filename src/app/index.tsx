import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { C } from '@/theme';
import { DEVICE_ID_KEY } from '@/native-api';

type DeviceCheck = 'checking' | 'ready' | 'weak' | 'unavailable';

export default function HomeScreen() {
  const [deviceCheck, setDeviceCheck] = useState<DeviceCheck>('checking');

  useEffect(() => {
    let mounted = true;

    async function checkDevice() {
      const enrolledDevice = await SecureStore.getItemAsync(DEVICE_ID_KEY);
      if (enrolledDevice) {
        router.replace('/clock');
        return;
      }
      const [hardware, enrolled, level] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.getEnrolledLevelAsync(),
      ]);

      if (!mounted) return;
      if (!hardware || !enrolled) setDeviceCheck('unavailable');
      else if (level !== LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG) setDeviceCheck('weak');
      else setDeviceCheck('ready');
    }

    checkDevice().catch(() => mounted && setDeviceCheck('unavailable'));
    return () => {
      mounted = false;
    };
  }, []);

  const isReady = deviceCheck === 'ready';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandGlyph}>O</Text></View>
          <View>
            <Text style={styles.brand}>OpsPro</Text>
            <Text style={styles.product}>PICKER</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>THIS PHONE</Text>
          <Text style={styles.title}>Make this your clock-in device.</Text>
          <Text style={styles.copy}>
            Your fingerprint or Face ID approves each punch. OpsPro never receives your biometric data.
          </Text>
        </View>

        <View style={[styles.devicePanel, isReady && styles.devicePanelReady]}>
          <View style={styles.scanRing}>
            {deviceCheck === 'checking' ? (
              <ActivityIndicator color={C.tealDark} size="large" />
            ) : (
              <Text style={styles.scanGlyph}>{isReady ? '✓' : '!'}</Text>
            )}
          </View>
          <View style={styles.deviceCopy}>
            <Text style={styles.deviceTitle}>{statusTitle(deviceCheck)}</Text>
            <Text style={styles.deviceDetail}>{statusDetail(deviceCheck)}</Text>
          </View>
        </View>

        <View style={styles.rules}>
          <Rule number="01" text="One picker, one registered phone" />
          <Rule number="02" text="Strong fingerprint or Face ID required" />
          <Rule number="03" text="Location checked at every punch" />
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={!isReady}
            onPress={() => router.push('/enroll')}
            style={({ pressed }) => [
              styles.primary,
              !isReady && styles.primaryDisabled,
              pressed && isReady && styles.primaryPressed,
            ]}
          >
            <Text style={styles.primaryText}>Set up this phone</Text>
            <Text style={styles.primaryArrow}>→</Text>
          </Pressable>
          <Text style={styles.help}>Need help? Ask your OpsPro supervisor.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function Rule({ number, text }: { number: string; text: string }) {
  return (
    <View style={styles.rule}>
      <Text style={styles.ruleNumber}>{number}</Text>
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

function statusTitle(status: DeviceCheck) {
  if (status === 'checking') return 'Checking device security…';
  if (status === 'ready') return 'Strong biometrics ready';
  if (status === 'weak') return 'Stronger security needed';
  return 'Biometrics not available';
}

function statusDetail(status: DeviceCheck) {
  if (status === 'checking') return 'This only takes a moment.';
  if (status === 'ready') return 'This phone can be registered safely.';
  if (status === 'weak') return 'Set up a Class 3 fingerprint or secure face unlock.';
  return 'Set up fingerprint or Face ID in your phone settings.';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  page: { flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: C.ink,
    alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-5deg' }],
  },
  brandGlyph: { color: C.teal, fontSize: 21, fontWeight: '900' },
  brand: { color: C.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  product: { color: C.tealDark, fontSize: 9, fontWeight: '800', letterSpacing: 2.4 },
  hero: { marginTop: 48 },
  eyebrow: { color: C.tealDark, fontSize: 12, fontWeight: '800', letterSpacing: 2.2 },
  title: { color: C.ink, fontSize: 39, lineHeight: 43, fontWeight: '800', letterSpacing: -1.5, marginTop: 10 },
  copy: { color: C.muted, fontSize: 17, lineHeight: 25, marginTop: 15, maxWidth: 340 },
  devicePanel: {
    marginTop: 30, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper,
    borderRadius: 22, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 16,
  },
  devicePanelReady: { borderColor: '#A5E8E2', backgroundColor: C.tealTint },
  scanRing: {
    width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderColor: C.teal,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper,
  },
  scanGlyph: { color: C.tealDark, fontSize: 30, fontWeight: '700' },
  deviceCopy: { flex: 1 },
  deviceTitle: { color: C.ink, fontSize: 16, fontWeight: '800' },
  deviceDetail: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  rules: { marginTop: 26, borderTopWidth: 1, borderTopColor: C.line },
  rule: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.line },
  ruleNumber: { width: 40, color: C.tealDark, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  ruleText: { flex: 1, color: C.ink, fontSize: 14, fontWeight: '600' },
  footer: { marginTop: 'auto', paddingTop: 22 },
  primary: {
    minHeight: 62, borderRadius: 18, backgroundColor: C.teal, paddingHorizontal: 22,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  primaryDisabled: { backgroundColor: '#C9D4D2' },
  primaryPressed: { transform: [{ scale: 0.985 }], backgroundColor: '#00B9AA' },
  primaryText: { color: C.ink, fontSize: 17, fontWeight: '800' },
  primaryArrow: { color: C.ink, fontSize: 25, fontWeight: '500' },
  help: { color: C.muted, textAlign: 'center', fontSize: 12, marginTop: 14 },
});
