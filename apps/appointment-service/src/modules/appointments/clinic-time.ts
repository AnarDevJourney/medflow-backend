// Clinic calendar helpers. Schedules are kept as clinic wall-clock times
// ('09:00' in Asia/Baku); the API and the database speak UTC.

export const CLINIC_TZ = 'Asia/Baku';

// How far ahead a slot can be booked (user decision, phase 7.1)
export const MAX_DAYS_AHEAD = 90;

const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TZ });
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLINIC_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// The clinic calendar day of an instant: 'YYYY-MM-DD'
export const clinicDate = (instant: Date): string => dateFormat.format(instant);

// The clinic wall-clock time of an instant: 'HH:mm'
export const clinicTime = (instant: Date): string => timeFormat.format(instant);

export const clinicToday = (): string => clinicDate(new Date());

// 'YYYY-MM-DD' + n days (calendar arithmetic, no time zone involved)
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Minutes the clinic is ahead of UTC at that instant (+240 for Baku)
function offsetMinutes(instant: Date): number {
  const p = Object.fromEntries(
    partsFormat.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

// Clinic wall-clock ('2026-11-16', '09:30') → the UTC instant
export function clinicInstant(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  return new Date(guess.getTime() - offsetMinutes(guess) * 60_000);
}

// 'HH:mm' → minutes since midnight
export const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

// minutes since midnight → 'HH:mm'
export const fromMinutes = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
