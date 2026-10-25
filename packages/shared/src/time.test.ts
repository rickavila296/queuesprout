import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  startOfMonthGrid,
  startOfWallDay,
  startOfWeek,
  toWallDate,
  toWallTime,
  wallTimeToUtc,
  weekdayIndex,
} from './time';

describe('wallTimeToUtc', () => {
  it.each([
    ['2026-07-01T09:30', 'UTC', '2026-07-01T09:30:00.000Z'],
    ['2026-07-01T09:30', 'America/New_York', '2026-07-01T13:30:00.000Z'],
    ['2026-01-15T09:30', 'America/New_York', '2026-01-15T14:30:00.000Z'],
    ['2026-07-01T09:30', 'Asia/Kolkata', '2026-07-01T04:00:00.000Z'],
    ['2026-01-01T00:00', 'Pacific/Auckland', '2025-12-31T11:00:00.000Z'],
  ])('%s in %s is %s', (wall, tz, iso) => {
    expect(wallTimeToUtc(wall, tz)?.toISOString()).toBe(iso);
  });

  it('round-trips through toWallTime', () => {
    const tz = 'Europe/Berlin';
    for (const wall of ['2026-03-28T12:00', '2026-03-29T12:00', '2026-10-25T12:00']) {
      const utc = wallTimeToUtc(wall, tz);
      expect(utc && toWallTime(utc, tz)).toBe(wall);
    }
  });

  it('resolves a time skipped by spring-forward to after the jump', () => {
    // 2026-03-08 02:30 does not exist in New York (clocks go 01:59 -> 03:00).
    expect(wallTimeToUtc('2026-03-08T02:30', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('picks the first occurrence of a repeated hour', () => {
    // 2026-11-01 01:30 happens twice in New York; the first is EDT (UTC-4).
    expect(wallTimeToUtc('2026-11-01T01:30', 'America/New_York')?.toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it.each(['', '2026-07-01', '2026-02-30T10:00', '2026-07-01 09:30', 'nope'])(
    'rejects %j',
    (wall) => {
      expect(wallTimeToUtc(wall, 'UTC')).toBeNull();
    },
  );
});

describe('day helpers', () => {
  it('formats the local day and time', () => {
    const at = new Date('2026-07-01T02:00:00Z');
    expect(toWallDate(at, 'America/Los_Angeles')).toBe('2026-06-30');
    expect(toWallTime(at, 'Asia/Tokyo')).toBe('2026-07-01T11:00');
  });

  it('finds local midnight', () => {
    expect(startOfWallDay('2026-07-01', 'America/New_York')?.toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    );
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('calendar grid helpers', () => {
  it('starts weeks on Monday', () => {
    expect(weekdayIndex('2026-10-26')).toBe(0); // Monday
    expect(weekdayIndex('2026-11-01')).toBe(6); // Sunday
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26');
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26');
  });

  it('starts the month grid on the Monday before the 1st', () => {
    expect(startOfMonthGrid('2026-11-17')).toBe('2026-10-26');
    expect(startOfMonthGrid('2026-06-30')).toBe('2026-06-01'); // June 1 2026 is a Monday
  });

  it('adds months, clamping the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });
});
