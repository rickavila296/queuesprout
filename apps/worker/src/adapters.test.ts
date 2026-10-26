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

  it('picks the live adapter for a real workspace in live mode', () => {
    // Selection only: nothing here calls the adapter.
    const pick = createAdapterPicker({ PUBLISH_MODE: 'live', PUBLIC_URL });
    expect(pick({ provider: 'bluesky', workspaceIsSandbox: false })).toMatchObject({
      ok: true,
      mock: false,
      adapter: { id: 'bluesky' },
    });
  });

  it('never falls back to mock for a real workspace in live mode', () => {
    const pick = createAdapterPicker({ PUBLISH_MODE: 'live', PUBLIC_URL });
    expect(pick({ provider: 'discord', workspaceIsSandbox: false })).toEqual({
      ok: false,
      error: 'not_implemented',
    });
  });
});
