import { describe, expect, it } from 'vitest';
import { composeSchema, effectiveItems, effectiveMedia, isOverride } from './compose';

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

describe('attachments', () => {
  const m1 = '0b7a5a4e-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
  const m2 = '1c8b6b5f-2d3e-4f4a-9bac-1d2e3f4a5b6c';

  it('defaults to none and keeps them inside the thread', () => {
    const parsed = composeSchema.parse(base);
    expect(parsed.baseMedia).toEqual([]);
    expect(parsed.channels[0]?.media).toEqual([]);
    expect(
      composeSchema.safeParse({ ...base, baseMedia: [[{ mediaId: m1 }], [{ mediaId: m2 }]] })
        .success,
    ).toBe(false);
    expect(
      composeSchema.safeParse({ ...base, baseMedia: [[{ mediaId: m1 }, { mediaId: m1 }]] }).success,
    ).toBe(false);
    const ok = composeSchema.parse({ ...base, baseMedia: [[{ mediaId: m1, altText: ' A cat ' }]] });
    expect(ok.baseMedia).toEqual([[{ mediaId: m1, altText: 'A cat' }]]);
  });

  it('follows the base thread unless the channel overrides it', () => {
    const baseMedia = [[{ mediaId: m1, altText: 'cat' }]];
    expect(effectiveMedia(['a', 'b'], baseMedia, { items: null, media: [] })).toEqual([
      [{ mediaId: m1, altText: 'cat' }],
      [],
    ]);
    expect(
      effectiveMedia(['a'], baseMedia, { items: ['c'], media: [[{ mediaId: m2, altText: '' }]] }),
    ).toEqual([[{ mediaId: m2, altText: '' }]]);
  });

  it('counts different attachments or alt text as customized', () => {
    const a = [[{ mediaId: m1, altText: 'cat' }]];
    expect(isOverride(['x'], ['x'], a, [[{ mediaId: m1, altText: 'cat' }]])).toBe(false);
    expect(isOverride(['x'], ['x'], a, [[{ mediaId: m1, altText: 'dog' }]])).toBe(true);
    expect(isOverride(['x'], ['x'], a, [])).toBe(true);
    expect(isOverride(['x'], ['x'], [], [[]])).toBe(false);
  });
});
