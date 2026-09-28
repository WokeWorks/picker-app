// Screen preview with sample data, for looking at the clock screen before a
// phone can be registered. Only reachable when __DEV__ is true (a development
// run); release builds compile it out, so a picker can never land in it.

export type DemoState = 'before' | 'on' | 'break' | 'done' | 'none';

const MIN = 60_000;
const HOUR = 60 * MIN;

export function demoSession(state: DemoState) {
  // A 10-hour shift that started 3 hours ago (on the hour, Dubai time), so the
  // preview always shows a shift in progress whatever time it is.
  const now = Date.now();
  const dubaiHour = new Date(now + 4 * HOUR).getUTCHours();
  const pad = (h: number) => `${String((h + 24) % 24).padStart(2, '0')}:00`;
  const store = {
    id: 'demo-store', name: 'Carrefour · Mall of the Emirates', chain: 'Carrefour', area: 'Mall of the Emirates',
    shift_start: pad(dubaiHour - 3), shift_end: pad(dubaiHour + 7),
    lat: 25.1181, lng: 55.2006,
  };
  const tomorrow = new Date(now + 4 * HOUR + 24 * HOUR).toISOString().slice(0, 10);
  const onShift = state === 'on' || state === 'break';
  return {
    employee: { id: 'demo', name: 'Saeed Sajid' },
    action: onShift ? 'clock_out' as const : 'clock_in' as const,
    clocked_in_at: onShift ? new Date(now - 2 * HOUR - 43 * MIN).toISOString() : null,
    locations: state === 'none' || state === 'done' ? [] : [store],
    break: onShift
      ? state === 'break'
        ? { on_break: true, break_used: true, started_at: new Date(now - 18 * MIN).toISOString(), ended_at: null }
        : { on_break: false, break_used: false, started_at: null, ended_at: null }
      : null,
    done_today: state === 'done'
      ? { clock_in: new Date(now - 10 * HOUR - 4 * MIN).toISOString(), clock_out: new Date(now - 6 * MIN).toISOString() }
      : null,
    next_shift: {
      date: tomorrow, start: '13:00', end: '23:00',
      name: 'Waitrose · Dubai Mall', chain: 'Waitrose', area: 'Dubai Mall', lat: 25.1972, lng: 55.2796,
    },
  };
}
