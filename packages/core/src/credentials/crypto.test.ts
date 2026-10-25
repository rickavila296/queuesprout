import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  accountSecretContext,
  blobKeyVersion,
  createKeyring,
  decryptSecret,
  encryptSecret,
  parseKeyring,
} from './crypto';

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const account = { workspaceId: 'ws-1', provider: 'bluesky', externalAccountId: 'did:plc:a' };
const ctx = accountSecretContext(account, 'access_token');

describe('encryptSecret / decryptSecret', () => {
  const ring = createKeyring(new Map([[1, k1]]), 1);

  it('round-trips and never stores the plaintext', () => {
    const blob = encryptSecret(ring, 'secret-token', ctx);
    expect(blob.includes(Buffer.from('secret-token'))).toBe(false);
    expect(decryptSecret(ring, blob, ctx)).toBe('secret-token');
  });

  it('uses a fresh IV every time', () => {
    expect(encryptSecret(ring, 'same', ctx).equals(encryptSecret(ring, 'same', ctx))).toBe(false);
  });

  it('rejects a blob moved to another account or column', () => {
    const blob = encryptSecret(ring, 'secret-token', ctx);
    const other = accountSecretContext(
      { ...account, externalAccountId: 'did:plc:b' },
      'access_token',
    );
    expect(() => decryptSecret(ring, blob, other)).toThrow(DecryptionError);
    const refreshCtx = accountSecretContext(account, 'refresh_token');
    expect(() => decryptSecret(ring, blob, refreshCtx)).toThrow(DecryptionError);
  });

  it('rejects tampered ciphertext without leaking it', () => {
    const blob = encryptSecret(ring, 'secret-token', ctx);
    const last = blob.length - 1;
    blob.writeUInt8(blob.readUInt8(last) ^ 0xff, last);
    expect(() => decryptSecret(ring, blob, ctx)).toThrow(/authentication failed/);
    try {
      decryptSecret(ring, blob, ctx);
    } catch (error) {
      expect(String(error)).not.toContain('secret-token');
    }
  });

  it('rejects garbage', () => {
    expect(() => decryptSecret(ring, Buffer.from('nope'), ctx)).toThrow(/unknown format/);
  });
});

describe('key rotation', () => {
  it('decrypts old blobs with the old key and writes new ones with the current key', () => {
    const old = createKeyring(new Map([[1, k1]]), 1);
    const blob = encryptSecret(old, 'token', ctx);
    const rotated = createKeyring(
      new Map([
        [2, k2],
        [1, k1],
      ]),
      2,
    );
    expect(decryptSecret(rotated, blob, ctx)).toBe('token');
    const fresh = encryptSecret(rotated, 'token', ctx);
    expect(blobKeyVersion(blob)).toBe(1);
    expect(blobKeyVersion(fresh)).toBe(2);
  });

  it('fails clearly when a key version is missing', () => {
    const blob = encryptSecret(createKeyring(new Map([[1, k1]]), 1), 'token', ctx);
    const without = createKeyring(new Map([[2, k2]]), 2);
    expect(() => decryptSecret(without, blob, ctx)).toThrow(/no key for version 1/);
  });
});

describe('parseKeyring', () => {
  const b64 = (b: Buffer) => b.toString('base64');

  it('reads a bare key as version 1', () => {
    expect(parseKeyring(b64(k1)).currentVersion).toBe(1);
  });

  it('reads versioned keys, first is current', () => {
    const ring = parseKeyring(`2:${b64(k2)}, 1:${b64(k1)}`);
    expect(ring.currentVersion).toBe(2);
    expect(ring.key(1)?.equals(k1)).toBe(true);
  });

  it.each([
    ['', /empty/],
    ['c2hvcnQ=', /32 bytes/],
    [`1:${b64(k1)},1:${b64(k2)}`, /Duplicate/],
    [`0:${b64(k1)}`, /1-65535/],
  ])('rejects %j', (value, error) => {
    expect(() => parseKeyring(value)).toThrow(error);
  });
});
