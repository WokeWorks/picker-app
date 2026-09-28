import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';

import { apiPost } from '@/native-api';

// Reminders come from the OpsPro server (shift starting, not clocked in,
// ending soon, break ending); the app only asks permission and tells the
// server where to deliver. See opspro-app src/lib/picker-reminders.ts.
//
// expo-notifications is loaded lazily: Expo Go on Android throws as soon as the
// module is imported (remote notifications were removed from it in SDK 53),
// which would take down every screen. A real build loads it normally.

type NotificationsModule = typeof import('expo-notifications');

const inExpoGoAndroid = Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let cached: NotificationsModule | null | undefined;
function notifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (inExpoGoAndroid) return (cached = null);
  try {
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

// Called once from the root layout: show reminders while the app is open, and
// open the clock screen when one is tapped. Returns the unsubscribe.
export function setupNotifications(onOpenClock: () => void): () => void {
  const N = notifications();
  if (!N) return () => {};
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  const sub = N.addNotificationResponseReceivedListener((response) => {
    if (response.notification.request.content.data?.screen === 'clock') onOpenClock();
  });
  return () => sub.remove();
}

export type PushSetup = 'registered' | 'denied' | 'unavailable';

// Ask for permission (once; later calls are silent) and send this phone's push
// address to the server. Never throws: reminders are a help, not a gate.
export async function registerForReminders(installSecret: string): Promise<PushSetup> {
  const N = notifications();
  if (!N || !Device.isDevice) return 'unavailable'; // Expo Go on Android, simulators
  try {
    if (Platform.OS === 'android') {
      // Must exist before asking on Android 13+; the server sends to this id.
      await N.setNotificationChannelAsync('reminders', {
        name: 'Shift reminders',
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        // Hide store and times on the lock screen; shown once unlocked.
        lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
      });
    }

    const current = await N.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) {
      granted = (await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })).granted;
    }
    if (!granted) {
      await apiPost('/api/mobile/push-token', { install_secret: installSecret, token: null }).catch(() => {});
      return 'denied';
    }

    // The EAS project id is set when the app is first built with EAS; until then
    // there is no push address to register.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return 'unavailable';

    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    await apiPost('/api/mobile/push-token', { install_secret: installSecret, token });
    return 'registered';
  } catch {
    return 'unavailable';
  }
}
