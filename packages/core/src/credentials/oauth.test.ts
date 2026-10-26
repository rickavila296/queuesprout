import { describe, expect, it } from 'vitest';
import { createKeyring, DecryptionError } from './crypto';
import {
  decryptAppSecret,
  decryptOAuthSecret,
  encryptAppSecret,
  encryptOAuthSecret,
  hashOAuthState,
  newOAuthState,
} from './oauth';

const keyring = createKeyring(new Map([[1, Buffer.alloc(32, 7)]]), 1);
const app = { provider: 'mastodon', instanceUrl: 'https://masto.test' };

describe('OAuth secrets', () => {
  it('round-trips a client secret bound to its provider app', () => {
    const blob = encryptAppSecret(keyring, app, 'client-secret');
    expect(blob.toString('utf8')).not.toContain('client-secret');
    expect(decryptAppSecret(keyring, app, blob)).toBe('client-secret');
    // A blob copied to another instance's row does not decrypt.
    expect(() =>
      decryptAppSecret(keyring, { ...app, instanceUrl: 'https://other.test' }, blob),
    ).toThrow(DecryptionError);
  });

  it('round-trips a PKCE verifier bound to its session and field', () => {
    const hash = hashOAuthState('state-1');
    const blob = encryptOAuthSecret(keyring, hash, 'code_verifier', 'verifier');
    expect(decryptOAuthSecret(keyring, hash, 'code_verifier', blob)).toBe('verifier');
    expect(() =>
      decryptOAuthSecret(keyring, hashOAuthState('state-2'), 'code_verifier', blob),
    ).toThrow(DecryptionError);
    expect(() => decryptOAuthSecret(keyring, hash, 'dpop_jwk', blob)).toThrow(DecryptionError);
  });

  it('makes unguessable states and stores only their hash', () => {
    const a = newOAuthState();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newOAuthState()).not.toBe(a);
    expect(hashOAuthState(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOAuthState(a)).toBe(hashOAuthState(a));
  });
});
