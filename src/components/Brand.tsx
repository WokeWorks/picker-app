import { StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme';

// Wordmark used at the top of every screen.
export function Brand() {
  return (
    <View style={styles.row}>
      <View style={styles.mark}><Text style={styles.markText}>O</Text></View>
      <Text style={styles.name}>OpsPro</Text>
      <Text style={styles.product}>Picker</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mark: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  markText: { color: C.onBrand, fontSize: 16, fontWeight: '800' },
  name: { color: C.ink, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  product: { color: C.muted, fontSize: 17, fontWeight: '500' },
});
