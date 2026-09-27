// The picker's rostered week plus what they actually worked, from
// POST /api/mobile/week (opspro-app). Days are GST calendar days, Monday first.

export type WeekDayStatus = 'scheduled' | 'off' | 'covered' | 'none';

export type WeekDay = {
  date: string;              // YYYY-MM-DD (GST)
  status: WeekDayStatus;     // off = explicit OFF; covered = given to a reliever; none = not rostered
  start: string | null;      // "13:00"
  end: string | null;
  store: { name: string; chain?: string | null; area?: string | null; lat: number | null; lng: number | null } | null;
  worked: { clockIn: string; clockOut: string | null; hours: number } | null; // clockOut null = still on shift
};

export type Week = {
  weekStart: string;
  today: string;
  days: WeekDay[];
  rosteredHours: number;
  workedHours: number;
};

export function shiftHours(start: string, end: string) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60; // overnight
  return mins / 60;
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function gstToday() {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}

// Sample weeks for the development preview (src/demo.ts).
export function demoWeek(which: 'this' | 'next'): Week {
  const today = gstToday();
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const monday = addDays(today, -dow + (which === 'next' ? 7 : 0));
  const dubaiMall = { name: 'Waitrose · Dubai Mall', chain: 'Waitrose', area: 'Dubai Mall', lat: 25.1972, lng: 55.2796 };
  const moe = { name: 'Carrefour · Mall of the Emirates', chain: 'Carrefour', area: 'Mall of the Emirates', lat: 25.1181, lng: 55.2006 };
  const plan: Array<Partial<WeekDay> & { status: WeekDayStatus }> = which === 'this'
    ? [
        { status: 'scheduled', start: '13:00', end: '23:00', store: moe },
        { status: 'scheduled', start: '13:00', end: '23:00', store: moe },
        { status: 'off' },
        { status: 'scheduled', start: '12:00', end: '23:00', store: dubaiMall },
        { status: 'scheduled', start: '13:00', end: '23:00', store: moe },
        { status: 'covered' },
        { status: 'scheduled', start: '13:00', end: '23:00', store: moe },
      ]
    : [
        { status: 'scheduled', start: '13:00', end: '23:00', store: moe },
        { status: 'off' },
        { status: 'scheduled', start: '13:00', end: '23:00', store: moe },
        { status: 'scheduled', start: '12:00', end: '23:00', store: dubaiMall },
        { status: 'none' },
        { status: 'none' },
        { status: 'none' },
      ];
  const days: WeekDay[] = plan.map((p, i) => {
    const date = addDays(monday, i);
    const day: WeekDay = { date, status: p.status, start: p.start ?? null, end: p.end ?? null, store: p.store ?? null, worked: null };
    // Past rostered days were worked, except one missed day to show that state.
    if (p.status === 'scheduled' && p.start && date < today && i !== 1) {
      const inAt = new Date(`${date}T${p.start}:00+04:00`).getTime() + 4 * 60_000;
      const outAt = inAt + (shiftHours(p.start, p.end!) * 60 + 3) * 60_000;
      day.worked = { clockIn: new Date(inAt).toISOString(), clockOut: new Date(outAt).toISOString(), hours: Math.round((outAt - inAt) / 360_000) / 10 };
    }
    return day;
  });
  const rosteredHours = days.reduce((t, d) => t + (d.status === 'scheduled' && d.start && d.end ? shiftHours(d.start, d.end) : 0), 0);
  const workedHours = days.reduce((t, d) => t + (d.worked?.hours ?? 0), 0);
  return { weekStart: monday, today, days, rosteredHours, workedHours: Math.round(workedHours * 10) / 10 };
}
