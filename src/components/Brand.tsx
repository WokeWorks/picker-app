import { StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme';

// Wordmark used at the top of every screen.
export function Brand() {
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="OpsPro Picker">
      {/* Both shrinkable and single-line. A parent with flexShrink can only
          squeeze this row if its CHILDREN can give way; without it the wordmark
          keeps its full width and whatever sits beside it is clipped instead.
          Bites hardest at a large font scale, where "Picker" grew under the
          header buttons. */}
      <Text style={styles.name} numberOfLines={1}>OpsPro</Text>
      <Text style={styles.product} numberOfLines={1}>Picker</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  name: { color: C.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.3, flexShrink: 0 },
  // "Picker" is the half that gives way: the product name can be squeezed before
  // "OpsPro" is touched.
  product: { color: C.muted, fontSize: 18, fontWeight: '500', flexShrink: 1 },
});
