import { useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { C } from '@/theme';

/** Opening is a reveal and wants to feel unhurried; closing is an answer already
 *  given, and waiting for it feels like lag. */
const OPEN_MS = 260;
const CLOSE_MS = 180;

/**
 * A bottom drawer for choosing where a file comes from.
 *
 * Animated by hand rather than with Modal's own `animationType="slide"`, because
 * that slides the ENTIRE modal including the backdrop — so the dark overlay flies
 * up from the bottom with the sheet instead of fading in behind it, which reads as
 * a glitch. Here the backdrop fades on its own track and only the sheet travels,
 * which is what a drawer is supposed to do.
 *
 * A sheet rather than Alert.alert: Alert's buttons are small, carry no icons, and
 * on Android render in an order the OS decides — so the wrong one can land under
 * the thumb, on screens that handle identity documents.
 */
/** One row in the drawer. Hidden entirely when the build cannot do it. */
export type SourceOption = {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** False in a build whose native module is missing — the row is left out. */
  available?: boolean;
};

export function SourceSheet({
  visible,
  title,
  options,
  onCancel,
}: {
  visible: boolean;
  title: string;
  /**
   * The choices, in order. An explicit list rather than camera/storage flags:
   * the two screens offer genuinely different sets — a document is never
   * photographed, a reference photo can never be a PDF — and flags meant one
   * screen passing its gallery option through a prop called `camera`, which
   * would have shipped a camera icon above the word "gallery".
   */
  options: SourceOption[];
  onCancel: () => void;
}) {
  const [anim] = useState(() => new Animated.Value(0));
  // Lags `visible` on the way out so the closing animation can finish before the
  // Modal is torn down. Without it the sheet vanishes instantly and the animation
  // is only ever seen opening.
  const [mounted, setMounted] = useState(visible);

  // Set during RENDER, not in the effect. React supports this for derived state,
  // and it keeps the effect to what it is for -- running the animation. Doing it
  // in the effect meant a synchronous setState there, which cascades a render.
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      Animated.timing(anim, {
        toValue: 1,
        duration: OPEN_MS,
        // Decelerating: quick off the bottom edge, settling as it arrives. Linear
        // reads as mechanical over this distance.
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
      // `finished` is false when a reopen interrupted this; unmounting then would
      // tear down the sheet that is currently sliding back in.
    }).start(({ finished }) => { if (finished) setMounted(false); });
  }, [visible, anim]);

  // Filtered once, so the divider logic below counts only rows that will render.
  const shown = options.filter((o) => o.available !== false);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        {/* The dismiss target. accessible={false} keeps a full-screen button out of
            the screen reader's order, where it would precede the real options; the
            Cancel row below is the readable way out. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessible={false} />
      </Animated.View>

      <SafeAreaView style={styles.dock} edges={['bottom']} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            {
              // 420 is comfortably taller than the sheet, so it starts fully
              // off-screen whichever rows are showing.
              transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
            },
          ]}
          accessibilityViewIsModal
        >
          {/* The handle people expect at the top of a drawer. Decorative: the sheet
              is not draggable, and a handle that resists dragging is worse than
              none — so it is small enough to read as trim rather than a control. */}
          <View style={styles.grabber} />
          <Text style={styles.title} accessibilityRole="header">{title}</Text>

          {shown.map((o, i) => (
            <View key={o.label}>
              {i > 0 && <View style={styles.divider} />}
              <Pressable
                accessibilityRole="button"
                onPress={o.onPress}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.icon}><Icon name={o.icon} size={21} color={C.brand} strokeWidth={2} /></View>
                <Text style={styles.rowText}>{o.label}</Text>
                <Icon name="arrowRight" size={19} color={C.muted} strokeWidth={2} />
              </Pressable>
            </View>
          ))}

          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            style={({ pressed }) => [styles.cancel, pressed && styles.rowPressed]}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(12,10,9,0.5)' },
  dock: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.paper, margin: 12, borderRadius: 22, paddingBottom: 12,
    borderWidth: 1, borderColor: C.line,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: C.line, marginTop: 10 },
  title: { color: C.muted, fontSize: 13, fontWeight: '700', textAlign: 'center', paddingVertical: 12, paddingHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15, paddingHorizontal: 18, minHeight: 60 },
  rowPressed: { backgroundColor: C.pressed },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, color: C.ink, fontSize: 16, fontWeight: '600' },
  divider: { height: 1, backgroundColor: C.line, marginLeft: 72 },
  cancel: { marginTop: 4, borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 15, alignItems: 'center', borderRadius: 14 },
  cancelText: { color: C.muted, fontSize: 16, fontWeight: '700' },
});
