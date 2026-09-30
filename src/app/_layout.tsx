import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LockGate } from '@/components/LockGate';
import { ensureNotificationChannels, setupNotifications, useLastNotificationResponse } from '@/notifications';
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

  // A tap that LAUNCHES the app from cold is not delivered to the listener below —
  // the app was not running to receive it. Expo keeps the last response for
  // exactly this, and without reading it the push lands on the home screen
  // instead of what it was about.
  const launchedBy = useLastNotificationResponse();
  const handledLaunch = useRef(false);
  useEffect(() => {
    if (handledLaunch.current || !launchedBy) return;
    handledLaunch.current = true;
    const screen = launchedBy.notification.request.content.data?.screen;
    if (screen === 'week') router.push('/week');
    else if (screen === 'notifications') router.push('/notifications');
  }, [launchedBy]);

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
