import { describe, expect, it } from 'vitest';
import { parseSavedNotice, savedNoticeQuery, savedNoticeText } from './saved-notice';

const tz = 'Europe/Berlin';
const now = new Date('2026-10-26T12:12:00Z');
const groupId = '7817b8cc-82df-4044-9ce2-f3f1ac961128';
const roundTrip = (q: string) => parseSavedNotice(Object.fromEntries(new URLSearchParams(q)));

describe('saved notice', () => {
  it('confirms a scheduled post with its local time and channel count', () => {
    const q = savedNoticeQuery(
      { mode: 'schedule', groupId, channels: 5, at: new Date('2026-10-26T12:14:00Z') },
      tz,
    );
    expect(q).toContain('date=2026-10-26');
    const notice = roundTrip(q);
    expect(notice && savedNoticeText(notice, tz, now)).toBe(
      'Scheduled for today at 13:14 on 5 channels.',
    );
  });

  it('names the day for a later date', () => {
    const notice = roundTrip(
      savedNoticeQuery(
        { mode: 'schedule', groupId, channels: 1, at: new Date('2026-10-28T08:00:00Z') },
        tz,
      ),
    );
    expect(notice && savedNoticeText(notice, tz, now)).toBe(
      'Scheduled for Wed, Oct 28 at 09:00 on 1 channel.',
    );
  });

  it('says a publish-now post is on its way', () => {
    const notice = roundTrip(savedNoticeQuery({ mode: 'now', groupId, channels: 5, at: now }, tz));
    expect(notice?.at).toBeNull();
    expect(notice && savedNoticeText(notice, tz, now)).toBe(
      'Publishing now to 5 channels. It should be live within a minute.',
    );
  });

  it('confirms drafts', () => {
    const notice = roundTrip(
      savedNoticeQuery({ mode: 'draft', groupId, channels: 2, at: null }, tz),
    );
    expect(notice && savedNoticeText(notice, tz, now)).toBe('Draft saved.');
  });

  it('ignores anything that is not a notice', () => {
    expect(parseSavedNotice({})).toBeNull();
    expect(parseSavedNotice({ view: 'week' })).toBeNull();
    expect(parseSavedNotice({ saved: 'schedule', group: 'nope', channels: '5' })).toBeNull();
    expect(parseSavedNotice({ saved: 'evil', group: groupId, channels: '5' })).toBeNull();
  });
});
