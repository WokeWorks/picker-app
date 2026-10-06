import { useLocalSearchParams, usePathname, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as SecureStore from 'expo-secure-store';

import { Icon, type IconName } from '@/components/Icon';
import { apiPost, INSTALL_SECRET_KEY } from '@/native-api';
import { setUnreadCount, useUnreadCount } from '@/unread';
import { setNavDirection } from '@/nav-direction';
import { C } from '@/theme';

/**
 * The fixed bar along the bottom of the three main screens.
 *
 * Home first, because that is where the app lands and where clocking in happens.
 * Profile is deliberately NOT here: it stays in the top-right corner where it has
 * always been, and it is a destination rather than a place to live.
 *
 * RENDERED ONCE, BY THE ROOT LAYOUT, not by each screen. That is what keeps it
 * still: a bar rendered inside a screen slides away with that screen's transition,
 * so changing tabs animated the bar along with the page it belongs to. Sitting
 * above the Stack instead, it stays put while the pages move underneath.
 *
 * It therefore decides for itself whether to appear, and reads its own unread
 * count -- no screen is passing it anything.
 *
 * Pinned with `position: 'absolute'`, so it does not scroll away. Screens must
 * reserve room for it with `useBottomNavPadding()` -- anything that does not will
 * have its last row sitting underneath the bar.
 */

const TABS: { href: '/clock' | '/week' | '/notifications'; icon: IconName; label: string }[] = [
  { href: '/clock', icon: 'home', label: 'Home' },
  { href: '/week', icon: 'calendar', label: 'Schedule' },
  { href: '/notifications', icon: 'alert', label: 'Notifications' },
];

/** Height of the bar itself, before the phone's bottom inset is added. */
export const BOTTOM_NAV_HEIGHT = 62;

/**
 * What a scrolling screen must add to its content's bottom padding.
 *
 * A hook rather than a constant because the home-indicator inset differs per
 * phone, and the brief is that nothing may sit under the bar.
 */
export function useBottomNavPadding(): number {
  const insets = useSafeAreaInsets();
  return BOTTOM_NAV_HEIGHT + insets.bottom + 12;
}

export function BottomNav() {
  const insets = useSafeAreaInsets();
  // Read from the shared store, so a message read on the notifications screen
  // clears the badge immediately rather than at the next tab change.
  const unread = useUnreadCount();
  const pathname = usePathname();
  // Carried through to the schedule screen, which is the only other screen that
  // reads it. The Schedule button this bar replaced passed it too, and without
  // this the DEV walkthrough would land on real data halfway through.
  const { demo } = useLocalSearchParams<{ demo?: string }>();
  // Only on the three it links to. Profile, documents, the viewer and setup are
  // all destinations rather than tabs, and a bar on them would offer a way out of
  // a screen that already has one.
  const onTab = TABS.some((t) => pathname === t.href);
  const active = Math.max(0, TABS.findIndex((t) => pathname.startsWith(t.href)));

  // The bubble slides between tabs rather than appearing under the new one, so the
  // change reads as one thing moving instead of two things blinking.
  const [barWidth, setBarWidth] = useState(0);
  // useState, not useRef: react-hooks/refs forbids reading a ref during render,
  // and the lazy initialiser still creates the value exactly once. Same pattern
  // as SourceSheet.
  const [slide] = useState(() => new Animated.Value(active));

  useEffect(() => {
    Animated.timing(slide, {
      toValue: active,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, slide]);

  // Re-read on every tab change. The notifications screen pushes the count into
  // the same store as it reads messages, so this is the backstop rather than the
  // only source: it catches a count that moved while the app was elsewhere.
  // Failures are swallowed -- a stale badge is not worth an error in front of a
  // picker.
  useEffect(() => {
    if (!onTab) return;
    let alive = true;
    void (async () => {
      try {
        const secret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
        if (!secret) return;
        const res = await apiPost<{ unread: number }>('/api/mobile/notifications', {
          install_secret: secret,
          before: null,
        });
        if (alive) setUnreadCount(res.unread ?? 0);
      } catch {
        // Leave the previous count rather than zeroing a badge that may be right.
      }
    })();
    return () => { alive = false; };
  }, [pathname, onTab]);

  if (!onTab) return null;

  const cell = barWidth / TABS.length;

  return (
    <View
      style={[styles.bar, { paddingBottom: insets.bottom, height: BOTTOM_NAV_HEIGHT + insets.bottom }]}
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
    >
      {cell > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bubble,
            {
              width: cell - 24,
              left: 12,
              transform: [{ translateX: Animated.multiply(slide, cell) }],
            },
          ]}
        />
      )}

      {TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Pressable
            key={tab.href}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={
              tab.href === '/notifications' && unread > 0
                ? `Notifications, ${unread} unread`
                : tab.label
            }
            // navigate, not push: it reuses the screen already in the stack, so
            // hopping between tabs cannot pile up a back history several deep.
            onPress={() => {
              if (isActive) return;
              // Which way along the bar. Left of here slides in from the left,
              // right of here from the right, so the motion matches the move.
              const target = TABS.findIndex((t) => t.href === tab.href);
              setNavDirection(target > active ? 'slide_from_right' : 'slide_from_left');
              router.navigate(tab.href === '/week' && demo === '1' ? '/week?demo=1' : tab.href);
            }}
            style={styles.tab}
            hitSlop={4}
          >
            <View>
              <Icon
                name={tab.icon}
                size={22}
                color={isActive ? C.brand : C.muted}
                strokeWidth={isActive ? 2.3 : 2}
              />
              {tab.href === '/notifications' && unread > 0 && (
                <View style={styles.badge}>
                  {/* Past 9 the exact number stops mattering and starts breaking
                      the circle, which is the usual convention for a reason. */}
                  <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
                </View>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.paper,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line,
  },
  bubble: {
    position: 'absolute', top: 8, height: 44, borderRadius: 22,
    backgroundColor: C.brandTint,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', height: BOTTOM_NAV_HEIGHT },
  badge: {
    position: 'absolute', top: -5, right: -9, minWidth: 17, height: 17, borderRadius: 9,
    paddingHorizontal: 4, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: C.onBrand, fontSize: 10, fontWeight: '800' },
});
