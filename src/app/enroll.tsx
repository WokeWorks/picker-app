import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as AppIntegrity from '@expo/app-integrity';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { C } from '@/theme';
import { apiPost, DEVICE_ID_KEY, encodeAndroidEnrollmentPayload, GOOGLE_CLOUD_PROJECT_NUMBER, INSTALL_SECRET_KEY, normalizeEnrollmentCode, sha256 } from '@/native-api';

export default function EnrollScreen() {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);

  async function verifyBiometric() {
    setChecking(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Approve OpsPro device setup',
        promptSubtitle: 'This confirms the phone can protect your clock-ins.',
        disableDeviceFallback: true,
        biometricsSecurityLevel: 'strong',
        requireConfirmation: true,
      });

      if (!result.success) return;
      if (Platform.OS !== 'android') throw new Error('iOS enrollment is not available yet.');
      if (!GOOGLE_CLOUD_PROJECT_NUMBER) throw new Error('Play Integrity project is not configured in this build.');

      const installSecret = `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
      const deviceLabel = 'Android picker phone';
      const codeSha256 = await sha256(normalizeEnrollmentCode(code));
      const installIdHash = await sha256(installSecret);
      const proofPayload = encodeAndroidEnrollmentPayload({ codeSha256, installIdHash, deviceLabel });
      const requestHash = await sha256(proofPayload);
      await AppIntegrity.prepareIntegrityTokenProviderAsync(GOOGLE_CLOUD_PROJECT_NUMBER);
      const integrityToken = await AppIntegrity.requestIntegrityCheckAsync(requestHash);
      const enrolled = await apiPost<{ device_id: string }>('/api/mobile/enroll', {
        code, platform: 'android', install_secret: installSecret, device_label: deviceLabel, integrity_token: integrityToken,
      });
      await SecureStore.setItemAsync(INSTALL_SECRET_KEY, installSecret, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      await SecureStore.setItemAsync(DEVICE_ID_KEY, enrolled.device_id, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      router.replace('/clock');
    } catch (error) {
      Alert.alert('Setup failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>

        <View style={styles.step}><Text style={styles.stepText}>STEP 1 OF 2</Text></View>
        <Text style={styles.title}>Enter your setup code.</Text>
        <Text style={styles.copy}>Your supervisor creates this one-time code. It links this phone to your picker profile.</Text>

        <Text style={styles.label}>ONE-TIME SETUP CODE</Text>
        <TextInput
          accessibilityLabel="One-time setup code"
          autoFocus
          autoCapitalize="characters"
          maxLength={12}
          onChangeText={(value) => setCode(value.toUpperCase())}
          placeholder="OP-XXXX-XXXX"
          placeholderTextColor="#9AA6A4"
          style={styles.input}
          value={code}
        />

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>What happens next</Text>
          <Text style={styles.noticeCopy}>Your phone will ask for fingerprint or Face ID, then create a device-only security key.</Text>
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={normalizeEnrollmentCode(code).length !== 10 || checking}
            onPress={verifyBiometric}
            style={({ pressed }) => [styles.primary, normalizeEnrollmentCode(code).length !== 10 && styles.disabled, pressed && styles.pressed]}
          >
            {checking ? <ActivityIndicator color={C.ink} /> : <Text style={styles.primaryText}>Check biometrics</Text>}
          </Pressable>
          <Text style={styles.locked}>The code expires after 15 minutes and works once.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  page: { flex: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 20 },
  back: { alignSelf: 'flex-start', paddingVertical: 12, paddingRight: 20 },
  backText: { color: C.tealDark, fontSize: 15, fontWeight: '700' },
  step: { alignSelf: 'flex-start', marginTop: 28, backgroundColor: C.tealTint, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  stepText: { color: C.tealDark, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: C.ink, fontSize: 38, lineHeight: 42, fontWeight: '800', letterSpacing: -1.4, marginTop: 18 },
  copy: { color: C.muted, fontSize: 17, lineHeight: 25, marginTop: 14 },
  label: { color: C.ink, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: 42, marginBottom: 10 },
  input: {
    height: 76, borderWidth: 2, borderColor: C.line, borderRadius: 18, backgroundColor: C.paper,
    color: C.ink, fontSize: 30, fontWeight: '700', letterSpacing: 12, paddingHorizontal: 20,
  },
  notice: { marginTop: 22, borderLeftWidth: 3, borderLeftColor: C.teal, paddingLeft: 15, paddingVertical: 3 },
  noticeTitle: { color: C.ink, fontSize: 14, fontWeight: '800' },
  noticeCopy: { color: C.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  footer: { marginTop: 'auto', paddingTop: 24 },
  primary: { minHeight: 62, borderRadius: 18, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  disabled: { backgroundColor: '#C9D4D2' },
  pressed: { transform: [{ scale: 0.985 }] },
  primaryText: { color: C.ink, fontSize: 17, fontWeight: '800' },
  locked: { color: C.muted, textAlign: 'center', fontSize: 11, lineHeight: 16, marginTop: 12 },
});
