import { describe, expect, it } from 'vitest';
import { charCount, defaultScheduleWall, resolveSchedule, validateThread } from './compose';

const channel = (provider: 'bluesky' | 'discord' | 'pinterest') => ({
  id: 'c1',
  provider,
  defaultSettings: provider === 'pinterest' ? { board_id: 'b1' } : {},
});

describe('validateThread', () => {
  it('passes a short Bluesky thread', () => {
    expect(validateThread(channel('bluesky'), ['one', 'two'])).toEqual([]);
  });

  it('flags text over the limit on the item it is about', () => {
    const issues = validateThread(channel('bluesky'), ['ok', 'x'.repeat(301)]);
    expect(issues).toMatchObject([{ code: 'text_too_long', itemPosition: 1 }]);
  });

  it('flags threads on channels without them', () => {
    expect(validateThread(channel('discord'), ['a', 'b'])).toMatchObject([
      { code: 'threads_unsupported' },
    ]);
  });

  it('flags empty items', () => {
    expect(validateThread(channel('bluesky'), ['  '])).toMatchObject([{ code: 'empty' }]);
  });

  it('checks settings against the channel defaults', () => {
    expect(validateThread({ ...channel('pinterest'), defaultSettings: {} }, ['pin'])).toMatchObject(
      [{ code: 'invalid_setting', message: 'Choose a board.' }],
    );
  });
});

describe('charCount', () => {
  it('counts graphemes on Bluesky', () => {
    expect(charCount('bluesky', '👩‍👩‍👧')).toEqual({ used: 1, max: 300 });
    expect(charCount('mastodon', '👩‍👩‍👧').used).toBeGreaterThan(1);
  });
});

describe('resolveSchedule', () => {
  const now = new Date('2026-11-02T14:00:00Z');
  const tz = 'America/New_York'; // UTC-5 in November

  it('publishes now as a post scheduled for this instant', () => {
    expect(resolveSchedule('now', undefined, tz, now)).toEqual({
      ok: true,
      status: 'scheduled',
      scheduledAt: now,
    });
  });

  it('converts the wall time in the workspace timezone', () => {
    expect(resolveSchedule('schedule', '2026-11-02T10:30', tz, now)).toEqual({
      ok: true,
      status: 'scheduled',
      scheduledAt: new Date('2026-11-02T15:30:00Z'),
    });
  });

  it('refuses a time that has passed, with a minute of slack', () => {
    expect(resolveSchedule('schedule', '2026-11-02T08:59', tz, now).ok).toBe(true);
    expect(resolveSchedule('schedule', '2026-11-02T08:58', tz, now)).toMatchObject({ ok: false });
    expect(resolveSchedule('schedule', undefined, tz, now)).toMatchObject({ ok: false });
  });

  it('keeps an optional time on drafts', () => {
    expect(resolveSchedule('draft', undefined, tz, now)).toEqual({
      ok: true,
      status: 'draft',
      scheduledAt: null,
    });
    expect(resolveSchedule('draft', '2026-01-01T09:00', tz, now)).toMatchObject({
      ok: true,
      status: 'draft',
    });
  });
});

describe('defaultScheduleWall', () => {
  it('rounds up to the next quarter hour at least 30 minutes out', () => {
    expect(defaultScheduleWall(new Date('2026-11-02T14:07:00Z'), 'UTC')).toBe('2026-11-02T14:45');
    expect(defaultScheduleWall(new Date('2026-11-02T14:00:00Z'), 'UTC')).toBe('2026-11-02T14:30');
  });
});
