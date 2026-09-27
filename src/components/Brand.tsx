import { Pressable, StyleSheet, Text } from 'react-native';

import { C } from '@/theme';

// Wordmark used at the top of every screen. `onLongPress` is only wired in the
// development preview (it brings back the hidden preview switcher).
export function Brand({ onLongPress }: { onLongPress?: () => void }) {
  return (
    <Pressable
      style={styles.row}
      onLongPress={onLongPress}
      disabled={!onLongPress}
      accessibilityRole="header"
      accessibilityLabel="OpsPro Picker"
    >
      <Text style={styles.name}>OpsPro</Text>
      <Text style={styles.product}>Picker</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minHeight: 30, alignSelf: 'flex-start' },
  name: { color: C.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  product: { color: C.muted, fontSize: 18, fontWeight: '500' },
});
