import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as AppIntegrity from '@expo/app-integrity';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { Icon } from '@/components/Icon';
import { friendlyError } from '@/messages';
import { C } from '@/theme';
import { apiPost, DEVICE_ID_KEY, encodeAndroidEnrollmentPayload, GOOGLE_CLOUD_PROJECT_NUMBER, INSTALL_SECRET_KEY, normalizeEnrollmentCode, sha256 } from '@/native-api';

export default function EnrollScreen() {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const codeComplete = normalizeEnrollmentCode(code).length === 10;

  async function verifyBiometric() {
    setChecking(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Approve OpsPro setup',
        promptSubtitle: 'Use the fingerprint or face you will clock in with.',
        disableDeviceFallback: true,
        biometricsSecurityLevel: 'strong',
        requireConfirmation: true,
      });

      if (!result.success) return;
      if (Platform.OS !== 'android') throw new Error('iPhone setup is not available yet.');
      if (!GOOGLE_CLOUD_PROJECT_NUMBER) throw new Error('This build of the app is not configured. Ask your supervisor.');

      // A fresh install secret on every setup attempt, so a re-registered phone
      // never reuses a revoked or replaced credential.
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
      Alert.alert('Setup failed', friendlyError(error));
    } finally {
      setChecking(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Icon name="arrowLeft" size={20} color={C.brand} strokeWidth={2} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <Text style={styles.title}>Enter your setup code</Text>
        <Text style={styles.copy}>Your admin gives you this code. It links this phone to you, works once, and expires after 15 minutes.</Text>

        <Text style={styles.label}>Setup code</Text>
        <TextInput
          accessibilityLabel="Setup code"
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
          onChangeText={(value) => setCode(value.toUpperCase())}
          placeholder="OP-XXXX-XXXX"
          placeholderTextColor={C.faint}
          style={[styles.input, codeComplete && styles.inputComplete]}
          value={code}
        />

        <View style={styles.notice}>
          <Icon name="info" size={20} color={C.brand} />
          <Text style={styles.noticeCopy}>Next, your phone asks for your fingerprint or face. Use the one you'll clock in with. Keep this code private, like a password.</Text>
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !codeComplete || checking, busy: checking }}
            disabled={!codeComplete || checking}
            onPress={verifyBiometric}
            style={({ pressed }) => [styles.primary, !codeComplete && styles.primaryDisabled, pressed && codeComplete && styles.primaryPressed]}
          >
            {checking
              ? <ActivityIndicator color={C.onBrand} />
              : <Text style={[styles.primaryText, !codeComplete && styles.primaryTextDisabled]}>Continue</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  page: { flex: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingRight: 16 },
  backText: { color: C.brand, fontSize: 16, fontWeight: '600' },
  title: { color: C.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7, marginTop: 20 },
  copy: { color: C.inkMid, fontSize: 16, lineHeight: 24, marginTop: 10 },
  label: { color: C.inkMid, fontSize: 14, fontWeight: '600', marginTop: 32, marginBottom: 8 },
  input: {
    height: 68, borderWidth: 1.5, borderColor: C.lineStrong, borderRadius: 14, backgroundColor: C.paper,
    color: C.ink, fontSize: 26, fontWeight: '700', letterSpacing: 4, paddingHorizontal: 18,
  },
  inputComplete: { borderColor: C.brand },
  notice: { flexDirection: 'row', gap: 12, marginTop: 20, backgroundColor: C.brandTint, borderRadius: 14, padding: 14 },
  noticeCopy: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 20 },
  footer: { marginTop: 'auto', paddingTop: 24 },
  primary: { minHeight: 58, borderRadius: 14, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  primaryDisabled: { backgroundColor: C.line },
  primaryPressed: { backgroundColor: C.brandDeep },
  primaryText: { color: C.onBrand, fontSize: 17, fontWeight: '700' },
  primaryTextDisabled: { color: C.faint },
});
