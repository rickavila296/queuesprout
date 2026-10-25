import { describe, expect, it } from 'vitest';
import { composeSchema, effectiveItems, isOverride } from './compose';

const channelId = '6f1d2c4e-8a9b-4c3d-9e2f-1a2b3c4d5e6f';
const base = {
  workspaceSlug: 'acme',
  baseItems: ['Hello'],
  channels: [{ channelId, items: null }],
  mode: 'draft' as const,
};

describe('composeSchema', () => {
  it('accepts a draft', () => {
    expect(composeSchema.safeParse(base).success).toBe(true);
  });

  it('needs a time to schedule', () => {
    const r = composeSchema.safeParse({ ...base, mode: 'schedule' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['scheduledAt']);
    expect(
      composeSchema.safeParse({ ...base, mode: 'schedule', scheduledAt: '2026-11-02T09:00' })
        .success,
    ).toBe(true);
  });

  it('needs a channel, once each', () => {
    expect(composeSchema.safeParse({ ...base, channels: [] }).success).toBe(false);
    expect(
      composeSchema.safeParse({
        ...base,
        channels: [
          { channelId, items: null },
          { channelId, items: ['x'] },
        ],
      }).success,
    ).toBe(false);
  });

  it('bounds threads', () => {
    expect(composeSchema.safeParse({ ...base, baseItems: [] }).success).toBe(false);
    expect(
      composeSchema.safeParse({ ...base, baseItems: Array.from({ length: 26 }, () => 'x') })
        .success,
    ).toBe(false);
  });
});

describe('overrides', () => {
  it('uses the base thread unless the channel overrides it', () => {
    expect(effectiveItems(['a', 'b'], { items: null })).toEqual(['a', 'b']);
    expect(effectiveItems(['a', 'b'], { items: ['c'] })).toEqual(['c']);
  });

  it('detects a customized channel', () => {
    expect(isOverride(['a', 'b'], ['a', 'b'])).toBe(false);
    expect(isOverride(['a', 'b'], ['a'])).toBe(true);
    expect(isOverride(['a'], ['b'])).toBe(true);
  });
});
