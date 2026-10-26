import { describe, expect, it } from 'vitest';
import { isOverdue } from './post-timing';

describe('isOverdue', () => {
  const now = new Date('2026-10-26T12:10:00Z');
  const at = (iso: string) => new Date(iso);

  it('flags a scheduled post more than two minutes past its time', () => {
    expect(isOverdue({ status: 'scheduled', scheduledAt: at('2026-10-26T12:06:00Z') }, now)).toBe(
      true,
    );
  });

  it('gives the dispatcher a moment before flagging', () => {
    expect(isOverdue({ status: 'scheduled', scheduledAt: at('2026-10-26T12:09:00Z') }, now)).toBe(
      false,
    );
  });

  it('ignores posts that are not waiting to be claimed', () => {
    const past = at('2026-10-26T12:00:00Z');
    expect(isOverdue({ status: 'published', scheduledAt: past }, now)).toBe(false);
    expect(isOverdue({ status: 'draft', scheduledAt: past }, now)).toBe(false);
    expect(isOverdue({ status: 'scheduled', scheduledAt: null }, now)).toBe(false);
  });
});
