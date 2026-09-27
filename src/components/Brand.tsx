import { StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme';

// Wordmark used at the top of every screen.
export function Brand() {
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="OpsPro Picker">
      <Text style={styles.name}>OpsPro</Text>
      <Text style={styles.product}>Picker</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minHeight: 30 },
  name: { color: C.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  product: { color: C.muted, fontSize: 18, fontWeight: '500' },
});
