import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';

import { Icon } from '@/components/Icon';
import { duration } from '@/components/ShiftProgress';
import { fmtTime } from '@/components/StoreCard';
import { hasPin, openDirections } from '@/maps';
import { friendlyError } from '@/messages';
import { apiPost, INSTALL_SECRET_KEY } from '@/native-api';
import { C } from '@/theme';
import { demoWeek, type Week, type WeekDay } from '@/week';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayNum(iso: string) { return Number(iso.slice(8, 10)); }
function monthName(iso: string) { return MONTHS[Number(iso.slice(5, 7)) - 1]; }

// "21 September – 27 September"; the years only appear when the week crosses
// New Year ("28 December 2026 – 3 January 2027").
function weekRange(first: string, last: string) {
  const crossesYear = first.slice(0, 4) !== last.slice(0, 4);
  const label = (iso: string) => `${dayNum(iso)} ${monthName(iso)}${crossesYear ? ` ${iso.slice(0, 4)}` : ''}`;
  return `${label(first)} – ${label(last)}`;
}

// Hours as "51h" / "31h 18m", the same style as the clock screen.
function hoursLabel(h: number) { return duration(Math.round(h * 60) * 60_000); }

function storeLine(store: NonNullable<WeekDay['store']>) {
  if (store.chain) return store.area ? `${store.chain} · ${store.area}` : store.chain;
  return store.name;
}

export default function WeekScreen() {
  const params = useLocalSearchParams<{ demo?: string }>();
  const demo = __DEV__ && params.demo === '1';
  const [which, setWhich] = useState<'this' | 'next'>('this');
  const [week, setWeek] = useState<Week | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (demo) { setWeek(demoWeek(which)); return; }
      const installSecret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
      if (!installSecret) throw new Error('device_inactive');
      setWeek(await apiPost<Week>('/api/mobile/week', { install_secret: installSecret, week: which }));
    } catch (e) {
      setWeek(null);
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [demo, which]);

  useEffect(() => { load(); }, [load]);

  const shifts = week?.days.filter((d) => d.status === 'scheduled').length ?? 0;
  // Next week has no "worked so far": two stats split the box in half.
  const statWidth = which === 'this' ? '33.333%' : '50%';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading && !!week} onRefresh={load} tintColor={C.brand} colors={[C.brand]} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { backgroundColor: C.pressed }]} hitSlop={8}>
            <Icon name="arrowLeft" size={20} color={C.ink} strokeWidth={2} />
          </Pressable>
          <Text style={styles.title}>Schedule</Text>
        </View>

        <View style={styles.segment} accessibilityRole="tablist">
          {(['this', 'next'] as const).map((w) => (
            <Pressable key={w} accessibilityRole="tab" accessibilityState={{ selected: which === w }} onPress={() => setWhich(w)} style={[styles.segBtn, which === w && styles.segBtnOn]}>
              <Text style={[styles.segText, which === w && styles.segTextOn]}>{w === 'this' ? 'This week' : 'Next week'}</Text>
            </Pressable>
          ))}
        </View>

        {loading && !week && <ActivityIndicator color={C.brand} style={{ marginTop: 40 }} />}
        {error && <Text style={styles.error}>{error}</Text>}

        {week && (
          <>
            <Text style={styles.range}>{weekRange(week.days[0].date, week.days[6].date)}</Text>
            <View style={styles.summaryRow}>
              <Stat first width={statWidth} value={String(shifts)} label={shifts === 1 ? 'shift' : 'shifts'} />
              <Stat width={statWidth} value={hoursLabel(week.rosteredHours)} label="rostered" />
              {which === 'this' && <Stat width={statWidth} value={hoursLabel(week.workedHours)} label="worked so far" accent />}
            </View>

            <View style={styles.days}>
              {week.days.map((d, i) => <DayRow key={d.date} day={d} weekday={WEEKDAYS[i]} today={week.today} />)}
            </View>

            {which === 'next' && week.days.some((d) => d.status === 'none') && (
              <Text style={styles.note}>Days that aren't rostered yet will fill in when your supervisor publishes them.</Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label, accent, first, width }: { value: string; label: string; accent?: boolean; first?: boolean; width: '33.333%' | '50%' }) {
  return (
    <View style={[styles.stat, { width }, !first && styles.statDivided]}>
      <Text style={[styles.statValue, accent && { color: C.brand }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DayRow({ day, weekday, today }: { day: WeekDay; weekday: string; today: string }) {
  const isToday = day.date === today;
  const isPast = day.date < today;
  const working = day.status === 'scheduled' && !!day.start && !!day.end;
  const missed = working && isPast && !day.worked;

  const date = (
    <View style={styles.dateCol}>
      {isToday
        ? <View style={styles.todayPill}><Text style={styles.todayPillText}>Today</Text></View>
        : <Text style={[styles.weekday, isPast && styles.pastInk]}>{weekday}</Text>}
      <Text style={[styles.dateNum, isToday && { color: C.brand }, isPast && styles.pastInk]}>{dayNum(day.date)}</Text>
    </View>
  );

  if (!working) {
    return (
      <View style={[styles.day, styles.dayQuiet, isToday && styles.dayToday]}>
        {date}
        <Text style={styles.quiet}>
          {day.status === 'off' ? 'Day off' : day.status === 'covered' ? 'Given to another picker' : 'Not rostered yet'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.day, isToday && styles.dayToday]}>
      {date}
      <View style={styles.body}>
        <Text style={[styles.time, isPast && styles.pastInk]}>{fmtTime(day.start!)} – {fmtTime(day.end!)}</Text>
        {day.store && <Text style={styles.store} numberOfLines={1}>{storeLine(day.store)}</Text>}

        {day.worked ? (
          <View style={styles.statusRow}>
            {day.worked.clockOut
              ? <Icon name="checkCircle" size={15} color={C.green} strokeWidth={2} />
              : <View style={styles.liveDot} />}
            <Text style={styles.statusDone}>
              {day.worked.clockOut
                ? `Worked ${duration(Date.parse(day.worked.clockOut) - Date.parse(day.worked.clockIn))}`
                : `On shift · ${duration(Date.now() - Date.parse(day.worked.clockIn))}`}
            </Text>
          </View>
        ) : missed ? (
          <View style={styles.statusRow}>
            <Icon name="alert" size={15} color={C.amber} strokeWidth={2} />
            <Text style={styles.statusMissed}>No clock-in recorded</Text>
          </View>
        ) : null}
      </View>

      {!isPast && hasPin(day.store) && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${day.store.name} in Maps`}
          onPress={() => day.store && openDirections(day.store)}
          style={({ pressed }) => [styles.mapBtn, pressed && { backgroundColor: C.brandTint }]}
          hitSlop={6}
        >
          <Icon name="pin" size={20} color={C.brand} strokeWidth={2} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  page: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  segment: { flexDirection: 'row', backgroundColor: C.pressed, borderRadius: 12, padding: 4, marginTop: 20 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segBtnOn: { backgroundColor: C.paper, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segText: { color: C.inkMid, fontSize: 15, fontWeight: '600' },
  segTextOn: { color: C.ink },
  error: { color: C.danger, fontSize: 15, marginTop: 24, textAlign: 'center' },
  range: { color: C.muted, fontSize: 14, fontWeight: '600', marginTop: 20 },
  summaryRow: { flexDirection: 'row', marginTop: 8, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 14 },
  stat: { paddingVertical: 12, paddingHorizontal: 14 },
  statDivided: { borderLeftWidth: 1, borderLeftColor: C.line },
  statValue: { color: C.ink, fontSize: 22, fontWeight: '800' },
  statLabel: { color: C.muted, fontSize: 13 },
  days: { marginTop: 16, gap: 10 },
  day: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.paper, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 14, paddingHorizontal: 14, gap: 14 },
  dayQuiet: { paddingVertical: 10 },
  dayToday: { borderColor: C.brand, borderWidth: 2 },
  dateCol: { width: 50, alignItems: 'center' },
  weekday: { color: C.muted, fontSize: 13, fontWeight: '600' },
  dateNum: { color: C.ink, fontSize: 24, fontWeight: '800', marginTop: 1 },
  pastInk: { color: C.muted },
  todayPill: { backgroundColor: C.brand, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
  todayPillText: { color: C.onBrand, fontSize: 11, fontWeight: '800' },
  body: { flex: 1, gap: 3 },
  time: { color: C.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  store: { color: C.inkMid, fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  statusDone: { color: C.green, fontSize: 13, fontWeight: '700' },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.green, marginHorizontal: 3 },
  statusMissed: { color: C.amber, fontSize: 13, fontWeight: '700' },
  quiet: { color: C.muted, fontSize: 15, fontWeight: '600' },
  mapBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.brandBorder, alignItems: 'center', justifyContent: 'center' },
  note: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 16, textAlign: 'center' },
});
