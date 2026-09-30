import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LockGate } from '@/components/LockGate';
import { ensureNotificationChannels, setupNotifications } from '@/notifications';
import { C } from '@/theme';

export default function RootLayout() {
  // Tapping a shift reminder opens the clock screen.
  // Tapping a push opens what it is about: roster changes go to the week view,
  // everything else to the clock screen.
  // Channels are created at app START, not on the clock screen. They used to be
  // made inside registerForReminders(), which only runs once a phone is already
  // registered and the picker opens the clock screen -- so every picker enrolled
  // before this release had no 'roster' channel, and on Android 8+ a push naming a
  // channel that does not exist may not be shown at all.
  useEffect(() => { void ensureNotificationChannels(); }, []);

  // A tap that LAUNCHES the app from cold is handled by the home screen, not
  // here, because it has to happen AFTER the startup redirect to /clock -- see
  // takeLaunchScreen() in src/notifications.ts. This listener only sees taps
  // that arrive while the app is already running.
  useEffect(() => setupNotifications((screen) => {
    if (screen === 'week') router.push('/week');
    else if (screen === 'notifications') router.push('/notifications');
    else router.push('/clock');
  }), []);

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
