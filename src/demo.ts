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
  const store = { id: 'demo-store', name: 'Carrefour · Mall of the Emirates', shift_start: '13:00', shift_end: '23:00', lat: 25.1181, lng: 55.2006 };
  return {
    employee: { id: 'demo', name: 'Saeed Sajid' },
    action: state === 'on' ? 'clock_out' as const : 'clock_in' as const,
    clocked_in_at: state === 'on' ? new Date(Date.now() - 3 * 3_600_000 - 17 * 60_000).toISOString() : null,
    locations: state === 'none' ? [] : [store],
  };
}
