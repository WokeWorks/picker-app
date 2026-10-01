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
export function setupNotifications(onOpen: (screen: string) => void): () => void {
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
    // Roster pushes carry screen 'week' and used to fall through here, so tapping
    // the banner did nothing at all -- the one interaction a notification exists
    // for. Anything unrecognised opens the clock screen rather than nowhere.
    const screen = response.notification.request.content.data?.screen;
    onOpen(screen === 'week' || screen === 'notifications' ? String(screen) : 'clock');
  });
  return () => sub.remove();
}

/**
 * The screen a notification tap LAUNCHED the app for, consumed once.
 *
 * A tap that starts the app from cold is never delivered to the listener in
 * setupNotifications() -- the app was not running to receive it -- so without
 * this the push lands on whatever screen the app opens by default instead of
 * what it was about.
 *
 * Two things this deliberately does:
 *
 * 1. It CLEARS the response after reading it. The OS caches the last tap, so
 *    leaving it in place means the next ordinary launch replays it and throws
 *    the picker onto a screen they did not ask for, possibly days later.
 * 2. It is a plain async function, not the useLastNotificationResponse hook.
 *    The hook resolves whenever React gets round to it, which raced the
 *    startup redirect on the home screen: the deep link pushed /week, then the
 *    redirect replaced it with /clock, and the tap was silently discarded.
 *    Reading it as one step of the startup sequence removes the race instead
 *    of trying to win it.
 *
 * Returns null when the app was opened normally, when the tap carries no screen
 * worth opening, or when the native module is missing (Expo Go).
 */
export async function takeLaunchScreen(): Promise<string | null> {
  const N = notifications();
  if (!N) return null;
  try {
    const response = await N.getLastNotificationResponseAsync();
    if (!response) return null;
    await N.clearLastNotificationResponseAsync();
    const screen = response.notification.request.content.data?.screen;
    return screen === 'week' || screen === 'notifications' ? String(screen) : null;
  } catch {
    // A launch-screen read is never worth failing a startup over.
    return null;
  }
}

export type PushSetup = 'registered' | 'denied' | 'unavailable';

/**
 * Create the Android notification channels. Safe to call repeatedly.
 *
 * Called from the root layout at app start, NOT from registerForReminders: a
 * channel has to exist before a push naming it arrives, and registration only
 * happens once a phone is enrolled and the picker opens the clock screen. Pickers
 * enrolled before these channels existed would otherwise never get one.
 */
export async function ensureNotificationChannels(): Promise<void> {
  const N = notifications();
  if (!N || Platform.OS !== 'android') return;
  try {
      // Must exist before asking on Android 13+; the server sends to this id.
      await N.setNotificationChannelAsync('reminders', {
        name: 'Shift reminders',
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        // Hide store and times on the lock screen; shown once unlocked.
        lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
      });
      // A SECOND channel, because the server sends roster changes on this id.
      // Both must be created here: on Android 8+ a push naming a channel that was
      // never registered does not get its own mute control, and may not be shown
      // at all. Without this the separate control is a promise the app does not
      // keep, and roster delivery is unproven.
      //
      // Separate so a picker can silence "your roster changed" without also
      // silencing "you have not clocked in" -- one is informational, the other
      // costs them money. DEFAULT rather than HIGH for the same reason: a roster
      // change is worth knowing, not worth interrupting.
      await N.setNotificationChannelAsync('roster', {
        name: 'Roster changes',
        importance: N.AndroidImportance.DEFAULT,
        lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
      });
      } catch {
    // A channel that cannot be created is not worth failing anything over; the
    // push simply lands on the system default.
  }
}

// Ask for permission (once; later calls are silent) and send this phone's push
// address to the server. Never throws: reminders are a help, not a gate.
export async function registerForReminders(installSecret: string): Promise<PushSetup> {
  const N = notifications();
  if (!N || !Device.isDevice) return 'unavailable'; // Expo Go on Android, simulators
  try {
    await ensureNotificationChannels();

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
