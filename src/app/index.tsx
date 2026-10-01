import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { useBiometricKind } from '@/biometric';
import { Brand } from '@/components/Brand';
import { Icon, type IconName } from '@/components/Icon';
import { C } from '@/theme';
import { DEVICE_ID_KEY } from '@/native-api';
import { takeLaunchScreen } from '@/notifications';

// 'unlocked' = the phone has no screen lock at all. That is the ONLY thing that
// stops a phone being set up.
//
// It used to also refuse any phone without a STRONG biometric, which made sense
// when the fingerprint was the identity proof on every punch. It is not any more:
// the server compares a selfie to the picker's reference photo, and that is what
// proves who is punching. Refusing a perfectly secure phone because its sensor is
// weak or absent turned away pickers for a check the system no longer relies on.
type DeviceCheck = 'checking' | 'ready' | 'unlocked';

export default function HomeScreen() {
  const [deviceCheck, setDeviceCheck] = useState<DeviceCheck>('checking');
  const bio = useBiometricKind();

  useEffect(() => {
    let mounted = true;

    async function checkDevice() {
      const enrolledDevice = await SecureStore.getItemAsync(DEVICE_ID_KEY);
      if (enrolledDevice) {
        // The cold-start deep link is resolved HERE, in sequence, rather than in
        // the root layout. Both used to navigate: the layout pushed the screen
        // the push was about, this replaced it with /clock a moment later, and
        // tapping a roster notification from cold silently landed on the clock
        // screen. Doing it in order means /clock is the screen behind, so Back
        // still works, and there is no race to lose.
        const launchScreen = await takeLaunchScreen();
        if (!mounted) return;
        router.replace('/clock');
        if (launchScreen === 'week') router.push('/week');
        else if (launchScreen === 'notifications') router.push('/notifications');
        return;
      }
      // SecurityLevel.NONE means no PIN, pattern, password or biometric — an
      // entirely unlocked phone. Anything above it (SECRET = PIN/pattern/password,
      // or either biometric level) is enough: whichever it is becomes the
      // credential the app asks for when it opens.
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (!mounted) return;
      setDeviceCheck(level === LocalAuthentication.SecurityLevel.NONE ? 'unlocked' : 'ready');
    }

    checkDevice().catch(() => mounted && setDeviceCheck('unlocked'));
    return () => {
      mounted = false;
    };
  }, []);

  const isReady = deviceCheck === 'ready';
  const hasProblem = deviceCheck === 'unlocked';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <Brand />

        <View style={styles.hero}>
          <Text style={styles.title}>Set up this phone for clocking in</Text>
          <Text style={styles.copy}>
            You'll take a photo of your face each time you clock in or out. Opening the app uses your fingerprint, face or phone passcode — whichever this phone has.
          </Text>
        </View>

        {/* Only when something needs fixing; a phone that is ready needs no card. */}
        {hasProblem && (
          <View style={[styles.status, styles.statusProblem]}>
            <View style={styles.statusIcon}>
              <Icon name="alert" size={22} color={C.amber} strokeWidth={2.2} />
            </View>
            <View style={styles.statusCopy}>
              <Text style={styles.statusTitle}>{statusTitle(deviceCheck)}</Text>
              <Text style={styles.statusDetail}>{statusDetail(deviceCheck)}</Text>
            </View>
          </View>
        )}

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
  if (status === 'checking') return 'Checking this phone…';
  if (status === 'ready') return 'This phone is ready';
  return 'This phone has no screen lock';
}

function statusDetail(status: DeviceCheck) {
  if (status === 'checking') return 'This only takes a moment.';
  if (status === 'ready') return 'Your phone lock will be used to open the app.';
  return 'Set a PIN, pattern or password in your phone settings, then come back. A fingerprint or face is optional — it just makes opening the app quicker.';
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
  statusProblem: { borderColor: '#FCD34D', backgroundColor: C.amberBg },
  statusIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
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
