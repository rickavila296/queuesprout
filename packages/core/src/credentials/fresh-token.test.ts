import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { InvalidGrantError, type AccountCredentials } from '@queuesprout/shared';
import { createKeyring } from './crypto';
import {
  decryptCredentials,
  encryptCredentials,
  getFreshToken,
  type CredentialStore,
  type EncryptedCredentials,
} from './fresh-token';

const keyring = createKeyring(new Map([[1, randomBytes(32)]]), 1);
const account = { workspaceId: 'ws', provider: 'mastodon', externalAccountId: '42' };
const NOW = new Date('2026-10-25T12:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

/** In-memory store with a real mutex, so concurrent calls serialise like the row lock. */
function memoryStore(initial: AccountCredentials) {
  let row: EncryptedCredentials = encryptCredentials(keyring, account, initial);
  let status: 'active' | 'needs_reauth' = 'active';
  let tail = Promise.resolve();
  const store: CredentialStore = {
    withLock(_accountId, fn) {
      const run = tail.then(() =>
        fn({
          row,
          save: async (next) => {
            row = next;
          },
          markNeedsReauth: async () => {
            status = 'needs_reauth';
          },
        }),
      );
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
  return {
    store,
    current: () => decryptCredentials(keyring, account, row),
    status: () => status,
  };
}

const creds = (over: Partial<AccountCredentials> = {}): AccountCredentials => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: minutes(60),
  scopes: ['write'],
  ...over,
});

const base = { keyring, accountId: 'acct', account, now: () => NOW };

describe('getFreshToken', () => {
  it('returns stored credentials while they are valid', async () => {
    const m = memoryStore(creds());
    const refresh = vi.fn();
    const result = await getFreshToken({ ...base, store: m.store, refresh });
    expect(result).toEqual({ ok: true, creds: creds(), refreshed: false });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('never refreshes tokens without an expiry (app passwords, bot tokens)', async () => {
    const m = memoryStore(creds({ expiresAt: null, refreshToken: null }));
    const refresh = vi.fn();
    const result = await getFreshToken({ ...base, store: m.store, refresh });
    expect(result.ok).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes inside the skew window and saves the rotated refresh token', async () => {
    const m = memoryStore(creds({ expiresAt: minutes(2) }));
    const refresh = vi.fn(async () =>
      creds({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: minutes(120) }),
    );
    const result = await getFreshToken({ ...base, store: m.store, refresh });
    expect(result).toMatchObject({ ok: true, refreshed: true, creds: { accessToken: 'access-2' } });
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'refresh-1' }));
    expect(m.current().refreshToken).toBe('refresh-2');
  });

  it('keeps the old refresh token when the platform does not rotate it', async () => {
    const m = memoryStore(creds({ expiresAt: minutes(-1) }));
    await getFreshToken({
      ...base,
      store: m.store,
      refresh: async () => creds({ accessToken: 'access-2', refreshToken: null }),
    });
    expect(m.current()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-1' });
  });

  it('refreshes once when two jobs race for the same account', async () => {
    const m = memoryStore(creds({ expiresAt: minutes(-1) }));
    let n = 0;
    const refresh = vi.fn(async (c: AccountCredentials) => {
      // A rotating platform: the old refresh token is single use.
      if (c.refreshToken !== 'refresh-1') throw new InvalidGrantError();
      n++;
      return creds({ accessToken: `access-${n + 1}`, refreshToken: `refresh-${n + 1}` });
    });
    const [a, b] = await Promise.all([
      getFreshToken({ ...base, store: m.store, refresh }),
      getFreshToken({ ...base, store: m.store, refresh }),
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ ok: true, refreshed: true, creds: { accessToken: 'access-2' } });
    expect(b).toMatchObject({ ok: true, refreshed: false, creds: { accessToken: 'access-2' } });
    expect(m.status()).toBe('active');
  });

  it('marks the account needs_reauth on invalid_grant', async () => {
    const m = memoryStore(creds({ expiresAt: minutes(-1) }));
    const result = await getFreshToken({
      ...base,
      store: m.store,
      refresh: async () => {
        throw new InvalidGrantError();
      },
    });
    expect(result).toMatchObject({ ok: false, error: 'needs_reauth' });
    expect(m.status()).toBe('needs_reauth');
  });

  it('leaves the row alone on a transient refresh failure', async () => {
    const m = memoryStore(creds({ expiresAt: minutes(-1) }));
    const result = await getFreshToken({
      ...base,
      store: m.store,
      refresh: async () => {
        throw new Error('503 from platform');
      },
    });
    expect(result).toEqual({ ok: false, error: 'refresh_failed', message: '503 from platform' });
    expect(m.status()).toBe('active');
    expect(m.current().accessToken).toBe('access-1');
  });
});
