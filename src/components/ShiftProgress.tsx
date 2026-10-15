import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme';

const DUBAI_OFFSET_MS = 4 * 3_600_000;
// The break length used when the server has not told us one -- an older API, or
// a response that predates per-organisation breaks. NOT "the" break length: that
// belongs to the shift's TYPE and arrives as break.break_ms from /api/mobile/session.
//
// This used to be a plain constant, and that was a real bug: a picker rostered
// on a 30-minute break watched this count down from 60 while the server ended
// their break at 30. They come back half an hour late, trusting the screen.
const FALLBACK_BREAK_MS = 3_600_000;

// "4:14 PM" in Dubai time.
export function clockTime(ms: number) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' });
}

export function duration(ms: number) {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(mins / 60);
  if (!h) return `${mins}m`;
  return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
}

// The rostered end as an instant: the clock-in's Dubai date + the end time,
// rolled to the next day for an overnight slot ("22:00" -> "06:00").
function rosteredEndMs(clockInMs: number, start: string, end: string) {
  const dubaiDate = new Date(clockInMs + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
  let endMs = Date.parse(`${dubaiDate}T${end}:00+04:00`);
  if (end <= start) endMs += 86_400_000;
  return endMs;
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// Live panel while the picker is on shift: time worked so far, clock-in and
// rostered end, and progress towards the end. On a break it switches to the
// break countdown instead.
export function ShiftProgress({ clockedInAt, shiftStart, shiftEnd, breakStartedAt, breakEndsAt, breakMs }: {
  clockedInAt: string;
  shiftStart?: string;
  shiftEnd?: string;
  breakStartedAt?: string | null; // set only while ON a break
  breakEndsAt?: string | null;    // when this break ends, from the server
  breakMs?: number | null;        // how long this shift's break is, from the server
}) {
  const now = useNow();

  if (breakStartedAt) {
    const startMs = Date.parse(breakStartedAt);
    // The server's own numbers, in order of how little arithmetic they need:
    // the instant it ends, then its length, then the old assumption. The first
    // two come from the shift's TYPE; only the last is a guess.
    const lengthMs = typeof breakMs === 'number' && breakMs > 0 ? breakMs : FALLBACK_BREAK_MS;
    const endMs = breakEndsAt ? Date.parse(breakEndsAt) : startMs + lengthMs;
    // Measured from the real end, so the bar and the countdown agree even when
    // the server's length and ends_at disagree with each other.
    const spanMs = Math.max(1, endMs - startMs);
    const left = Math.max(0, endMs - now);
    return (
      <View style={[styles.panel, styles.breakPanel]} accessibilityLabel={`On break, ${duration(left)} left`}>
        <View style={styles.labelRow}>
          <View style={[styles.liveDot, { backgroundColor: C.onOrange }]} />
          <Text style={[styles.label, styles.onOrange]}>On break</Text>
        </View>
        <Text style={[styles.big, styles.onOrange]}>{duration(left)} <Text style={styles.bigUnit}>left</Text></Text>
        <Text style={[styles.meta, styles.onOrange]}>Back by {clockTime(endMs)}  ·  Started {clockTime(startMs)}</Text>
        <View style={[styles.track, { backgroundColor: 'rgba(36,31,30,0.18)' }]}>
          <View style={[styles.fill, { width: `${Math.max(2, Math.min(1, (now - startMs) / spanMs) * 100)}%`, backgroundColor: C.onOrange }]} />
        </View>
      </View>
    );
  }

  const inMs = Date.parse(clockedInAt);
  const endMs = shiftStart && shiftEnd ? rosteredEndMs(inMs, shiftStart, shiftEnd) : null;
  const progress = endMs && endMs > inMs ? Math.min(1, (now - inMs) / (endMs - inMs)) : null;
  const over = endMs != null && now > endMs;

  return (
    <View style={styles.panel} accessibilityLabel={`On shift for ${duration(now - inMs)}`}>
      <View style={styles.labelRow}>
        <View style={styles.liveDot} />
        <Text style={styles.label}>On shift</Text>
      </View>
      <Text style={styles.big}>{duration(now - inMs)}</Text>
      <Text style={styles.meta}>
        Clocked in {clockTime(inMs)}
        {endMs != null && (over
          ? <Text style={styles.over}>{`  ·  Shift ended ${clockTime(endMs)}`}</Text>
          : `  ·  Ends ${clockTime(endMs)}`)}
      </Text>
      {progress != null && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.max(2, progress * 100)}%` }, over && styles.fillOver]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 16, backgroundColor: C.brand, borderRadius: 16, padding: 18 },
  breakPanel: { backgroundColor: C.orange },
  onOrange: { color: C.onOrange },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6EE7A8' },
  label: { color: C.onBrandMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  big: { color: C.onBrand, fontSize: 40, fontWeight: '800', letterSpacing: -1, marginTop: 4 },
  bigUnit: { fontSize: 22, fontWeight: '700', letterSpacing: 0 },
  meta: { color: C.onBrandMuted, fontSize: 15, marginTop: 2 },
  over: { color: '#FCD34D', fontWeight: '700' },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', marginTop: 14, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: '#6EE7A8' },
  fillOver: { backgroundColor: '#FCD34D' },
});
