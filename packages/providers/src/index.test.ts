import { describe, expect, it } from 'vitest';
import { resolveAdapter } from './index';
import { buildPublishContext } from './testing';

const opts = { publicUrl: 'http://localhost:3000', wait: async () => undefined };

describe('resolveAdapter', () => {
  it('returns the mock adapter in mock mode for every provider', async () => {
    const r = resolveAdapter('bluesky', true, opts);
    expect(r).toMatchObject({ ok: true, mock: true });
    if (!r.ok) return;
    const step = await r.adapter.publish(buildPublishContext());
    expect(step.kind === 'done' && step.externalId).toMatch(/^mock_bluesky_/);
  });

  it('refuses live publishing for providers without a live adapter yet', () => {
    expect(resolveAdapter('tiktok', false, opts)).toEqual({ ok: false, error: 'not_implemented' });
  });
});
