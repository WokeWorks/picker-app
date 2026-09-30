import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LockGate } from '@/components/LockGate';
import { setupNotifications } from '@/notifications';
import { C } from '@/theme';

export default function RootLayout() {
  // Tapping a shift reminder opens the clock screen.
  useEffect(() => setupNotifications(() => router.push('/clock')), []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {/* A registered phone asks for a fingerprint or face before showing
          anything. Convenience, not a punch-path control -- see src/lock.ts. */}
      <LockGate>
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: C.canvas } }} />
      </LockGate>
    </SafeAreaProvider>
  );
}
