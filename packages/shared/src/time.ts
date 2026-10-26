/**
 * Timezone helpers with no date library. The database stores UTC; these convert to
 * and from a workspace's wall-clock time only at the edges (forms and calendar cells).
 */

/** "YYYY-MM-DDTHH:mm", the value of an <input type="datetime-local">. */
export const WALL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(date: Date, timeZone: string): WallParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Offset of timeZone from UTC at that instant, in ms (positive east of UTC). */
function offsetMs(date: Date, timeZone: string): number {
  const p = wallParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which the clock in timeZone shows `wall`. A time skipped by a
 * DST jump resolves to the same clock reading after the jump; a repeated hour resolves
 * to its first occurrence. Returns null for a malformed value.
 */
export function wallTimeToUtc(wall: string, timeZone: string): Date | null {
  const m = WALL_TIME_PATTERN.exec(wall);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(guess)) return null;
  const check = new Date(guess);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;

  // Try the offsets in force just before and after the guess, and keep the earliest
  // candidate whose clock reading matches.
  const offsets = new Set([
    offsetMs(new Date(guess - 86_400_000), timeZone),
    offsetMs(new Date(guess), timeZone),
    offsetMs(new Date(guess + 86_400_000), timeZone),
  ]);
  const candidates = [...offsets].map((o) => guess - o).sort((a, b) => a - b);
  for (const c of candidates) {
    if (toWallTime(new Date(c), timeZone) === wall) return new Date(c);
  }
  // Inside a DST gap: no candidate matches. Use the offset from before the jump.
  return new Date(guess - offsetMs(new Date(guess - 86_400_000), timeZone));
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** The clock reading in timeZone at that instant, as "YYYY-MM-DDTHH:mm". */
export function toWallTime(date: Date, timeZone: string): string {
  const p = wallParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The calendar day in timeZone at that instant, as "YYYY-MM-DD". */
export function toWallDate(date: Date, timeZone: string): string {
  return toWallTime(date, timeZone).slice(0, 10);
}

/** UTC instant of local midnight starting the day "YYYY-MM-DD" in timeZone. */
export function startOfWallDay(day: string, timeZone: string): Date | null {
  return wallTimeToUtc(`${day}T00:00`, timeZone);
}

/** "YYYY-MM-DD" plus n days (calendar arithmetic, no timezone involved). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/** ISO weekday of "YYYY-MM-DD": 0 is Monday, 6 is Sunday. */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Monday on or before "YYYY-MM-DD". */
export function startOfWeek(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** The first day shown in a month grid: the Monday on or before the 1st. Six weeks follow. */
export function startOfMonthGrid(day: string): string {
  return startOfWeek(`${day.slice(0, 7)}-01`);
}

/** "YYYY-MM-DD" in the next (or previous, n < 0) month, clamped to that month's length. */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
