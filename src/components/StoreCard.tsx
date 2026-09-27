import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { hasPin, openDirections } from '@/maps';
import { C } from '@/theme';

type Store = { name: string; chain?: string | null; area?: string | null; lat: number | null; lng: number | null };

// "Carrefour · Mall of the Emirates" -> chain + area. The server sends them
// separately; the split is the fallback for a store with no chain/area set.
function storeParts(l: Store) {
  if (l.chain) return { chain: l.chain, area: l.area ?? null };
  const [chain, ...rest] = l.name.split(' · ');
  return { chain, area: rest.join(' · ') || null };
}

// Roster time "13:00" -> "1 PM", "13:30" -> "1:30 PM".
export function fmtTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

// A store and its shift times: chain over area on the left, start/end stacked
// on the right, "Open in Maps" along the bottom when the store has a pin.
export function StoreCard({ label, store, start, end, style }: {
  label: string;
  store: Store;
  start: string;
  end: string;
  style?: object;
}) {
  const { chain, area } = storeParts(store);
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.top}>
        <View style={styles.copy}>
          <Text style={styles.chain}>{chain}</Text>
          {area && <Text style={styles.area}>{area}</Text>}
        </View>
        <View style={styles.times} accessibilityLabel={`${fmtTime(start)} to ${fmtTime(end)}`}>
          <Text style={styles.timeBig}>{fmtTime(start)}</Text>
          <Text style={styles.timeTo}>to</Text>
          <Text style={styles.timeBig}>{fmtTime(end)}</Text>
        </View>
      </View>
      {hasPin(store) && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${store.name} in Maps`}
          onPress={() => openDirections(store)}
          style={({ pressed }) => [styles.mapCta, pressed && { backgroundColor: C.brandTint }]}
        >
          <Icon name="pin" size={18} color={C.brand} strokeWidth={2} />
          <Text style={styles.mapCtaText}>Open in Maps</Text>
        </Pressable>
      )}
    </View>
  );
}

// Same frame, for "no shift" style messages.
export function EmptyCard({ title, note, style }: { title: string; note: string; style?: object }) {
  return (
    <View style={[styles.card, style]}>
      <View style={[styles.top, { paddingTop: 16 }]}>
        <View style={styles.copy}>
          <Text style={[styles.chain, { marginTop: 0 }]}>{title}</Text>
          <Text style={styles.note}>{note}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: 'hidden' },
  top: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 2 },
  copy: { flex: 1 },
  label: { color: C.muted, fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingTop: 16 },
  chain: { color: C.ink, fontSize: 20, fontWeight: '700', marginTop: 4 },
  area: { color: C.inkMid, fontSize: 18, fontWeight: '500', marginTop: 1 },
  note: { color: C.inkMid, fontSize: 14, lineHeight: 20, marginTop: 4 },
  times: { alignItems: 'flex-end', justifyContent: 'center' },
  timeBig: { color: C.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  timeTo: { color: C.muted, fontSize: 12, fontWeight: '600', marginVertical: 1 },
  mapCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 14,
  },
  mapCtaText: { color: C.brand, fontSize: 16, fontWeight: '700' },
});
