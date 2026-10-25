import { describe, expect, it } from 'vitest';
import { createAdapterPicker } from './adapters';

const PUBLIC_URL = 'http://localhost:3000';

describe('createAdapterPicker', () => {
  it('uses the mock adapter when PUBLISH_MODE is mock', () => {
    const pick = createAdapterPicker({ PUBLISH_MODE: 'mock', PUBLIC_URL });
    expect(pick({ provider: 'bluesky', workspaceIsSandbox: false })).toMatchObject({ mock: true });
  });

  it('uses the mock adapter for sandbox workspaces even in live mode', () => {
    const pick = createAdapterPicker({ PUBLISH_MODE: 'live', PUBLIC_URL });
    expect(pick({ provider: 'bluesky', workspaceIsSandbox: true })).toMatchObject({ mock: true });
  });

  it('never falls back to mock for a real workspace in live mode', () => {
    const pick = createAdapterPicker({ PUBLISH_MODE: 'live', PUBLIC_URL });
    expect(pick({ provider: 'bluesky', workspaceIsSandbox: false })).toEqual({
      ok: false,
      error: 'not_implemented',
    });
  });
});
