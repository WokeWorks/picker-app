import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';

import { Icon } from '@/components/Icon';
import { openDirections } from '@/maps';
import { friendlyError } from '@/messages';
import { apiPost, INSTALL_SECRET_KEY } from '@/native-api';
import { C } from '@/theme';
import { demoWeek, type Week, type WeekDay } from '@/week';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayNum(iso: string) { return Number(iso.slice(8, 10)); }
function monthName(iso: string) { return MONTHS[Number(iso.slice(5, 7)) - 1]; }
function gstTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
}
// "21 September – 27 September"; the years only appear when the week crosses
// New Year ("28 December 2026 – 3 January 2027").
function weekRange(first: string, last: string) {
  const crossesYear = first.slice(0, 4) !== last.slice(0, 4);
  const label = (iso: string) => `${dayNum(iso)} ${monthName(iso)}${crossesYear ? ` ${iso.slice(0, 4)}` : ''}`;
  return `${label(first)} – ${label(last)}`;
}
function fmtHours(h: number) { return `${Math.round(h * 10) / 10}h`; }

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

  const range = week ? weekRange(week.days[0].date, week.days[6].date) : '';
  const shifts = week?.days.filter((d) => d.status === 'scheduled').length ?? 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading && !!week} onRefresh={load} tintColor={C.brand} colors={[C.brand]} />}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Icon name="arrowLeft" size={20} color={C.brand} strokeWidth={2} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <Text style={styles.title}>Your shifts</Text>

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
            <View style={styles.summary}>
              <Text style={styles.range}>{range}</Text>
              <View style={styles.summaryRow}>
                <Stat first value={String(shifts)} label={shifts === 1 ? 'shift' : 'shifts'} />
                <Stat value={fmtHours(week.rosteredHours)} label="rostered" />
                {which === 'this' && <Stat value={fmtHours(week.workedHours)} label="worked so far" accent />}
              </View>
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

function Stat({ value, label, accent, first }: { value: string; label: string; accent?: boolean; first?: boolean }) {
  return (
    <View style={[styles.stat, !first && styles.statDivided]}>
      <Text style={[styles.statValue, accent && { color: C.brand }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DayRow({ day, weekday, today }: { day: WeekDay; weekday: string; today: string }) {
  const isToday = day.date === today;
  const isPast = day.date < today;
  const working = day.status === 'scheduled';
  const missed = working && isPast && !day.worked;

  let detail: { text: string; color: string; icon?: 'checkCircle' | 'alert' | 'clock' } | null = null;
  if (day.worked) {
    detail = day.worked.clockOut
      ? { text: `Clocked ${gstTime(day.worked.clockIn)} – ${gstTime(day.worked.clockOut)} · ${fmtHours(day.worked.hours)}`, color: C.green, icon: 'checkCircle' }
      : { text: `On shift since ${gstTime(day.worked.clockIn)}`, color: C.green, icon: 'clock' };
  } else if (missed) {
    detail = { text: 'No clock-in recorded', color: C.amber, icon: 'alert' };
  }

  return (
    <View style={[styles.day, isToday && styles.dayToday]}>
      <View style={styles.dateCol}>
        <Text style={[styles.weekday, isToday && styles.todayInk]}>{isToday ? 'Today' : weekday}</Text>
        <Text style={[styles.dateNum, isToday && styles.todayInk]}>{dayNum(day.date)}</Text>
      </View>

      <View style={styles.dayBody}>
        {working && day.start && day.end ? (
          <>
            <Text style={styles.time}>{day.start} – {day.end}</Text>
            {day.store && (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Directions to ${day.store.name}`}
                disabled={day.store.lat == null}
                onPress={() => day.store && openDirections(day.store)}
                style={styles.storeRow}
                hitSlop={6}
              >
                <Icon name="pin" size={15} color={C.brand} />
                <Text style={styles.store} numberOfLines={1}>{day.store.name}</Text>
                {day.store.lat != null && !isPast && <Text style={styles.directions}>Directions</Text>}
              </Pressable>
            )}
            {detail && (
              <View style={styles.detailRow}>
                {detail.icon && <Icon name={detail.icon} size={15} color={detail.color} />}
                <Text style={[styles.detail, { color: detail.color }]}>{detail.text}</Text>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.quiet}>
            {day.status === 'off' ? 'Day off' : day.status === 'covered' ? 'Given to another picker' : 'Not rostered'}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  page: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingRight: 16 },
  backText: { color: C.brand, fontSize: 16, fontWeight: '600' },
  title: { color: C.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.7, marginTop: 8 },
  segment: { flexDirection: 'row', backgroundColor: C.pressed, borderRadius: 12, padding: 4, marginTop: 16 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segBtnOn: { backgroundColor: C.paper, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segText: { color: C.inkMid, fontSize: 15, fontWeight: '600' },
  segTextOn: { color: C.ink },
  error: { color: C.danger, fontSize: 15, marginTop: 24, textAlign: 'center' },
  summary: { marginTop: 20 },
  range: { color: C.muted, fontSize: 14, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', marginTop: 10, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 14 },
  stat: { width: '33.333%', paddingVertical: 12, paddingHorizontal: 14 },
  statDivided: { borderLeftWidth: 1, borderLeftColor: C.line },
  statValue: { color: C.ink, fontSize: 24, fontWeight: '800' },
  statLabel: { color: C.muted, fontSize: 13 },
  days: { marginTop: 20, gap: 10 },
  day: { flexDirection: 'row', backgroundColor: C.paper, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14, gap: 14 },
  dayToday: { borderColor: C.brand, borderWidth: 2, backgroundColor: C.brandTint },
  dateCol: { width: 48, alignItems: 'center' },
  weekday: { color: C.muted, fontSize: 13, fontWeight: '600' },
  dateNum: { color: C.ink, fontSize: 24, fontWeight: '800', marginTop: 2 },
  todayInk: { color: C.brand },
  dayBody: { flex: 1, justifyContent: 'center', gap: 5 },
  time: { color: C.ink, fontSize: 17, fontWeight: '700' },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  store: { flexShrink: 1, color: C.inkMid, fontSize: 14 },
  directions: { color: C.brand, fontSize: 13, fontWeight: '700', marginLeft: 'auto' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detail: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  quiet: { color: C.muted, fontSize: 15, fontWeight: '500' },
  note: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 16, textAlign: 'center' },
});
