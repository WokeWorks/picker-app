// Screen preview with sample data, for looking at the clock screen before a
// phone can be registered. Only reachable when __DEV__ is true (a development
// run); release builds compile it out, so a picker can never land in it.

export type DemoState = 'before' | 'on' | 'none';

export const DEMO_STATES: Array<{ id: DemoState; label: string }> = [
  { id: 'before', label: 'Before shift' },
  { id: 'on', label: 'On shift' },
  { id: 'none', label: 'No shift' },
];

export function demoSession(state: DemoState) {
  // A 10-hour shift that started 3 hours ago (on the hour, Dubai time), so the
  // preview always shows a shift in progress whatever time it is.
  const dubaiHour = new Date(Date.now() + 4 * 3_600_000).getUTCHours();
  const pad = (h: number) => `${String((h + 24) % 24).padStart(2, '0')}:00`;
  const store = {
    id: 'demo-store', name: 'Carrefour · Mall of the Emirates',
    shift_start: pad(dubaiHour - 3), shift_end: pad(dubaiHour + 7),
    lat: 25.1181, lng: 55.2006,
  };
  return {
    employee: { id: 'demo', name: 'Saeed Sajid' },
    action: state === 'on' ? 'clock_out' as const : 'clock_in' as const,
    clocked_in_at: state === 'on' ? new Date(Date.now() - 2 * 3_600_000 - 43 * 60_000).toISOString() : null,
    locations: state === 'none' ? [] : [store],
  };
}
