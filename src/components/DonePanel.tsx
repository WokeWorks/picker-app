import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { clockTime, duration } from '@/components/ShiftProgress';
import { C } from '@/theme';

// "Shift done" summary: a big green tick beside the hours worked and the
// clock-in/out times, on a white card.
export function DonePanel({ clockIn, clockOut }: { clockIn: string; clockOut: string }) {
  const worked = duration(Date.parse(clockOut) - Date.parse(clockIn));
  const times = `${clockTime(Date.parse(clockIn))} – ${clockTime(Date.parse(clockOut))}`;
  return (
    <View style={styles.panel} accessibilityLabel={`Shift done, ${worked} worked, ${times}`}>
      <View style={styles.badge}><Icon name="check" size={30} color={C.onBrand} strokeWidth={2.6} /></View>
      <View style={styles.copy}>
        <Text style={styles.label}>Shift done</Text>
        <Text style={styles.big}>{worked}</Text>
        <Text style={styles.meta}>{times}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: 16, borderRadius: 16, padding: 18, backgroundColor: C.paper,
    borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 16,
  },
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  label: { color: C.brand, fontSize: 13, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  big: { color: C.ink, fontSize: 40, fontWeight: '800', letterSpacing: -1, marginTop: 4 },
  meta: { color: C.inkMid, fontSize: 15, marginTop: 2 },
});
