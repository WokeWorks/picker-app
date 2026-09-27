import { Linking, Platform } from 'react-native';

export type StorePin = { name: string; lat: number | null; lng: number | null };

export function hasPin(store: StorePin | null | undefined): store is StorePin & { lat: number; lng: number } {
  return !!store && store.lat != null && store.lng != null;
}

// Opens the phone's maps app with directions to the store's pin: Apple Maps on
// iPhone, Google Maps (app, or browser if it isn't installed) on Android.
export function openDirections(store: StorePin) {
  if (!hasPin(store)) return;
  const q = `${store.lat},${store.lng}`;
  const url = Platform.OS === 'ios'
    ? `https://maps.apple.com/?daddr=${q}&q=${encodeURIComponent(store.name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  Linking.openURL(url).catch(() => {});
}
