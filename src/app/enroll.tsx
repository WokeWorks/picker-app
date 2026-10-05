import { router } from 'expo-router';
import { useRef, useState } from 'react';
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
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { biometricFailureMessage } from '@/biometric';
import { Icon } from '@/components/Icon';
import { requestSetupProof } from '@/integrity';
import { friendlyError } from '@/messages';
import { C } from '@/theme';
import { apiPost, DEVICE_ID_KEY, encodeAndroidEnrollmentPayload, encodeIosEnrollmentPayload, formatEnrollmentCode, formatPhone, INSTALL_SECRET_KEY, isUaeMobile, phoneDigits, normalizeEnrollmentCode, sha256, writeAppAttestKeyId } from '@/native-api';

export default function EnrollScreen() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const codeRef = useRef<TextInput>(null);
  const phoneComplete = isUaeMobile(phone);
  const codeComplete = normalizeEnrollmentCode(code).length === 8 && phoneComplete;

  async function verifyBiometric() {
    setChecking(true);
    try {
      // Confirms a real person is holding the phone before it is permanently bound
      // to this picker. Device fallback is ON for the same reason as the lock
      // screen: a phone with only a passcode is allowed to enrol now, so refusing
      // it here would re-impose the gate that was just removed, one screen later.
      //
      // promptSubtitle no longer promises a fingerprint at punch time — it is a
      // photo now. Saying otherwise here is the first thing a picker reads about
      // how clocking in works.
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Approve OpsPro setup',
        promptSubtitle: 'This links this phone to you.',
        disableDeviceFallback: false,
        biometricsSecurityLevel: 'strong',
        requireConfirmation: true,
      });

      if (!result.success) {
        const why = biometricFailureMessage(result);
        if (why) Alert.alert('Setup not approved', why);
        return;
      }
      const isIos = Platform.OS === 'ios';

      // A fresh install secret on every setup attempt, so a re-registered phone
      // never reuses a revoked or replaced credential.
      const installSecret = `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
      const deviceLabel = isIos ? 'iPhone picker phone' : 'Android picker phone';
      const codeSha256 = await sha256(normalizeEnrollmentCode(code));
      const installIdHash = await sha256(installSecret);
      const payloadArgs = { codeSha256, installIdHash, deviceLabel };
      // Android proves itself over a HASH of its payload; iOS signs the payload
      // string itself, which the native module hashes. Both are built here so the
      // two paths cannot drift apart.
      const androidPayload = encodeAndroidEnrollmentPayload(payloadArgs);
      const proof = await requestSetupProof({
        androidRequestHash: await sha256(androidPayload),
        iosChallenge: encodeIosEnrollmentPayload(payloadArgs),
      });
      const enrolled = await apiPost<{ device_id: string }>('/api/mobile/enroll', {
        code,
        phone: phoneDigits(phone),
        install_secret: installSecret,
        device_label: deviceLabel,
        ...proof,
      }, { timeoutMs: 45_000 });
      // The key id is stored BEFORE the install secret. readEnrolment treats the
      // install secret as the signal that this phone is set up, so if the app were
      // killed between the two writes, the other order would leave a phone that
      // looks enrolled and can never sign a punch.
      if (proof.platform === 'ios') await writeAppAttestKeyId(proof.key_id);
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

        <Text style={styles.title}>Confirm it's you</Text>
        <Text style={styles.copy}>Enter your mobile number and the 8-digit code you received from your supervisor. This links this phone to you.</Text>

        <Text style={styles.label}>Mobile number</Text>
        <TextInput
          accessibilityLabel="Mobile number"
          autoFocus
          autoComplete="tel"
          textContentType="telephoneNumber"
          keyboardType="phone-pad"
          maxLength={12}
          onChangeText={(value) => {
            const next = formatPhone(value);
            setPhone(next);
            if (isUaeMobile(next)) codeRef.current?.focus();
          }}
          placeholder="050 123 4567"
          placeholderTextColor={C.faint}
          style={[styles.input, phoneComplete && styles.inputComplete]}
          value={phone}
        />

        <Text style={styles.label}>Setup code</Text>
        <TextInput
          ref={codeRef}
          accessibilityLabel="Setup code"
          autoCorrect={false}
          keyboardType="number-pad"
          maxLength={9}
          onChangeText={(value) => setCode(formatEnrollmentCode(value))}
          placeholder="1234 5678"
          placeholderTextColor={C.faint}
          style={[styles.input, normalizeEnrollmentCode(code).length === 8 && styles.inputComplete]}
          value={code}
        />

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
  label: { color: C.inkMid, fontSize: 14, fontWeight: '600', marginTop: 24, marginBottom: 8 },
  input: {
    height: 68, borderWidth: 1.5, borderColor: C.lineStrong, borderRadius: 14, backgroundColor: C.paper,
    color: C.ink, fontSize: 26, fontWeight: '700', letterSpacing: 4, paddingHorizontal: 18,
  },
  inputComplete: { borderColor: C.brand },
  footer: { marginTop: 'auto', paddingTop: 24 },
  primary: { minHeight: 58, borderRadius: 14, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  primaryDisabled: { backgroundColor: C.line },
  primaryPressed: { backgroundColor: C.brandDeep },
  primaryText: { color: C.onBrand, fontSize: 17, fontWeight: '700' },
  primaryTextDisabled: { color: C.faint },
});
