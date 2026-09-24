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

import { C } from '@/theme';

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
      Alert.alert(
        'Phone check passed',
        'Server enrollment is intentionally locked until the backend enrollment endpoint is deployed.',
      );
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

        <Text style={styles.label}>6-DIGIT SETUP CODE</Text>
        <TextInput
          accessibilityLabel="Six digit setup code"
          autoFocus
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
          placeholder="000 000"
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
            disabled={code.length !== 6 || checking}
            onPress={verifyBiometric}
            style={({ pressed }) => [styles.primary, code.length !== 6 && styles.disabled, pressed && styles.pressed]}
          >
            {checking ? <ActivityIndicator color={C.ink} /> : <Text style={styles.primaryText}>Check biometrics</Text>}
          </Pressable>
          <Text style={styles.locked}>Enrollment submission will activate with the backend release.</Text>
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
