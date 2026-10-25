import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for tokens at rest (ADR-010). Each blob is self-describing:
 *
 *   [format 1 byte = 0x01][key version uint16 BE][iv 12 bytes][auth tag 16 bytes][ciphertext]
 *
 * The key version lets keys rotate: new writes use the current key, old blobs still
 * decrypt with the key they name. The context string is bound as additional
 * authenticated data, so a blob copied into another row or column fails to decrypt.
 */

const FORMAT = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + 2 + IV_BYTES + TAG_BYTES;
export const KEY_BYTES = 32;

export interface Keyring {
  /** Version used for new encryptions. */
  readonly currentVersion: number;
  key(version: number): Buffer | undefined;
}

export class DecryptionError extends Error {
  constructor(reason: string) {
    // Never include the blob or the key in the message.
    super(`Could not decrypt secret: ${reason}`);
    this.name = 'DecryptionError';
  }
}

export function createKeyring(keys: ReadonlyMap<number, Buffer>, currentVersion: number): Keyring {
  for (const [version, key] of keys) {
    if (!Number.isInteger(version) || version < 1 || version > 0xffff) {
      throw new Error(`Key version must be 1-65535, got ${version}`);
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(`Key version ${version} must be ${KEY_BYTES} bytes, got ${key.length}`);
    }
  }
  if (!keys.has(currentVersion)) throw new Error(`No key for current version ${currentVersion}`);
  const copy = new Map(keys);
  return { currentVersion, key: (version) => copy.get(version) };
}

/**
 * Parses TOKEN_ENCRYPTION_KEY. Either one base64 key (version 1), or a comma-separated
 * list of version:base64 pairs whose first entry is the current key:
 *
 *   TOKEN_ENCRYPTION_KEY=2:<new key>,1:<old key>
 *
 * Generate a key with `openssl rand -base64 32`.
 */
export function parseKeyring(value: string): Keyring {
  const entries = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error('TOKEN_ENCRYPTION_KEY is empty');

  const keys = new Map<number, Buffer>();
  let current: number | undefined;
  for (const entry of entries) {
    const match = /^(\d+):(.+)$/.exec(entry);
    const version = match?.[1] ? Number(match[1]) : 1;
    const encoded = match?.[2] ?? entry;
    if (keys.has(version)) throw new Error(`Duplicate key version ${version}`);
    keys.set(version, Buffer.from(encoded, 'base64'));
    current ??= version;
  }
  if (current === undefined) throw new Error('TOKEN_ENCRYPTION_KEY has no keys');
  return createKeyring(keys, current);
}

export function encryptSecret(keyring: Keyring, plaintext: string, context: string): Buffer {
  const version = keyring.currentVersion;
  const key = keyring.key(version);
  if (!key) throw new Error(`No key for version ${version}`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const header = Buffer.alloc(3);
  header.writeUInt8(FORMAT, 0);
  header.writeUInt16BE(version, 1);
  return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
}

/** The key version a blob was written with, for finding rows to re-encrypt. */
export function blobKeyVersion(blob: Buffer): number {
  if (blob.length < HEADER_BYTES || blob.readUInt8(0) !== FORMAT) {
    throw new DecryptionError('unknown format');
  }
  return blob.readUInt16BE(1);
}

export function decryptSecret(keyring: Keyring, blob: Buffer, context: string): string {
  const version = blobKeyVersion(blob);
  const key = keyring.key(version);
  if (!key) throw new DecryptionError(`no key for version ${version}`);
  const iv = blob.subarray(3, 3 + IV_BYTES);
  const tag = blob.subarray(3 + IV_BYTES, HEADER_BYTES);
  const ciphertext = blob.subarray(HEADER_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptionError('authentication failed');
  }
}

export interface AccountKey {
  workspaceId: string;
  provider: string;
  externalAccountId: string;
}

export type AccountSecretField = 'access_token' | 'refresh_token' | 'dpop_jwk';

/**
 * AAD for one secret of one account. Uses the account's natural key, not its id,
 * because apps/web encrypts before app.connect_account() has created the row.
 */
export const accountSecretContext = (account: AccountKey, field: AccountSecretField) =>
  `account_credentials:${account.workspaceId}:${account.provider}:${account.externalAccountId}:${field}`;
