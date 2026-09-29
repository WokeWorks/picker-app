import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { useBiometricKind } from '@/biometric';
import { Brand } from '@/components/Brand';
import { Icon, type IconName } from '@/components/Icon';
import { C } from '@/theme';
import { DEVICE_ID_KEY } from '@/native-api';

// v1 is Android only: iPhone registration needs Apple App Attest, planned for a
// later version. iPhone users clock in at the store kiosk until then.
type DeviceCheck = 'checking' | 'ready' | 'weak' | 'unavailable' | 'iphone';

export default function HomeScreen() {
  const [deviceCheck, setDeviceCheck] = useState<DeviceCheck>('checking');
  const bio = useBiometricKind();

  useEffect(() => {
    let mounted = true;

    async function checkDevice() {
      const enrolledDevice = await SecureStore.getItemAsync(DEVICE_ID_KEY);
      if (enrolledDevice) {
        router.replace('/clock');
        return;
      }
      if (Platform.OS === 'ios') {
        if (mounted) setDeviceCheck('iphone');
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
  const hasProblem = deviceCheck === 'weak' || deviceCheck === 'unavailable';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <Brand />

        <View style={styles.hero}>
          <Text style={styles.title}>Set up this phone for clocking in</Text>
          <Text style={styles.copy}>
            You'll approve every clock-in and clock-out with your fingerprint or face. Your fingerprint and face never leave this phone.
          </Text>
        </View>

        <View style={[styles.status, isReady && styles.statusReady, hasProblem && styles.statusProblem]}>
          <View style={[styles.statusIcon, isReady && styles.statusIconReady]}>
            {deviceCheck === 'checking'
              ? <ActivityIndicator color={C.brand} />
              : <Icon name={isReady ? 'check' : deviceCheck === 'iphone' ? 'info' : 'alert'} size={22} color={isReady ? C.onBrand : deviceCheck === 'iphone' ? C.brand : C.amber} strokeWidth={2.2} />}
          </View>
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>{statusTitle(deviceCheck)}</Text>
            <Text style={styles.statusDetail}>{statusDetail(deviceCheck)}</Text>
          </View>
        </View>

        <View style={styles.rules}>
          <Rule icon="phone" text="One picker, one phone" />
          <Rule icon={bio ?? 'fingerprint'} text={`Your ${bio === 'face' ? 'face' : 'fingerprint'} approves each punch`} />
          <Rule icon="pin" text="Your location is checked at every punch" />
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !isReady }}
            disabled={!isReady}
            onPress={() => router.push('/enroll')}
            style={({ pressed }) => [styles.primary, !isReady && styles.primaryDisabled, pressed && isReady && styles.primaryPressed]}
          >
            <Text style={[styles.primaryText, !isReady && styles.primaryTextDisabled]}>Set up this phone</Text>
            <Icon name="arrowRight" size={22} color={isReady ? C.onBrand : C.faint} strokeWidth={2} />
          </Pressable>
          <Text style={styles.help}>Need help? Ask your supervisor.</Text>
          {__DEV__ && (
            <Pressable accessibilityRole="button" onPress={() => router.push('/clock?demo=1')} style={styles.devLink}>
              <Text style={styles.devLinkText}>Preview the clock-in screen (test builds only)</Text>
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function Rule({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.rule}>
      <View style={styles.ruleIcon}><Icon name={icon} size={18} color={C.brand} /></View>
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

function statusTitle(status: DeviceCheck) {
  if (status === 'iphone') return 'iPhone support is coming soon';
  if (status === 'checking') return 'Checking this phone…';
  if (status === 'ready') return 'This phone is ready';
  if (status === 'weak') return 'Stronger phone lock needed';
  return 'Fingerprint or face unlock is off';
}

function statusDetail(status: DeviceCheck) {
  if (status === 'iphone') return "For now, clock in at your store's kiosk.";
  if (status === 'checking') return 'This only takes a moment.';
  if (status === 'ready') return 'Fingerprint or face unlock is set up.';
  if (status === 'weak') return 'Set up fingerprint unlock in your phone settings, then come back.';
  return 'Turn on fingerprint or face unlock in your phone settings, then come back.';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  page: { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 20 },
  hero: { marginTop: 40 },
  title: { color: C.ink, fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8 },
  copy: { color: C.inkMid, fontSize: 16, lineHeight: 24, marginTop: 12 },
  status: {
    marginTop: 28, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper,
    borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  statusReady: { borderColor: C.brandBorder, backgroundColor: C.brandTint },
  statusProblem: { borderColor: '#FCD34D', backgroundColor: C.amberBg },
  statusIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  statusIconReady: { backgroundColor: C.brand },
  statusCopy: { flex: 1 },
  statusTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  statusDetail: { color: C.inkMid, fontSize: 14, lineHeight: 20, marginTop: 2 },
  rules: { marginTop: 24, gap: 4 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  ruleIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' },
  ruleText: { flex: 1, color: C.ink, fontSize: 15, fontWeight: '500' },
  footer: { marginTop: 'auto', paddingTop: 20 },
  primary: {
    minHeight: 58, borderRadius: 14, backgroundColor: C.brand, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  primaryDisabled: { backgroundColor: C.line },
  primaryPressed: { backgroundColor: C.brandDeep },
  primaryText: { color: C.onBrand, fontSize: 17, fontWeight: '700' },
  primaryTextDisabled: { color: C.faint },
  help: { color: C.muted, textAlign: 'center', fontSize: 13, marginTop: 12 },
  devLink: { alignSelf: 'center', marginTop: 10, paddingVertical: 6, paddingHorizontal: 10 },
  devLinkText: { color: C.brand, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
