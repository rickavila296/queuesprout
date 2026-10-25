import { describe, expect, it } from 'vitest';
import { parseWorkerEnv } from './env';

const key = Buffer.alloc(32, 7).toString('base64');
const base = { WORKER_DATABASE_URL: 'postgres://u:p@localhost:5432/db', TOKEN_ENCRYPTION_KEY: key };

describe('parseWorkerEnv', () => {
  it('defaults to mock publishing (ADR-019)', () => {
    expect(parseWorkerEnv(base).PUBLISH_MODE).toBe('mock');
  });

  it('refuses live publishing in tests', () => {
    expect(() => parseWorkerEnv({ ...base, NODE_ENV: 'test', PUBLISH_MODE: 'live' })).toThrow(
      /never allowed in tests/,
    );
  });

  it('requires the worker database url', () => {
    expect(() => parseWorkerEnv({})).toThrow(/WORKER_DATABASE_URL/);
  });

  it('parses MIGRATE_ON_START', () => {
    expect(parseWorkerEnv({ ...base, MIGRATE_ON_START: 'false' }).MIGRATE_ON_START).toBe(false);
  });

  it('parses the token encryption keyring', () => {
    expect(parseWorkerEnv(base).TOKEN_ENCRYPTION_KEY.currentVersion).toBe(1);
    const rotated = parseWorkerEnv({ ...base, TOKEN_ENCRYPTION_KEY: `2:${key},1:${key}` });
    expect(rotated.TOKEN_ENCRYPTION_KEY.currentVersion).toBe(2);
  });

  it('rejects a missing or malformed encryption key without echoing it', () => {
    const { TOKEN_ENCRYPTION_KEY: _, ...withoutKey } = base;
    expect(() => parseWorkerEnv(withoutKey)).toThrow(/TOKEN_ENCRYPTION_KEY is required/);
    expect(() => parseWorkerEnv({ ...base, TOKEN_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
    expect(() => parseWorkerEnv({ ...base, TOKEN_ENCRYPTION_KEY: 'c2hvcnQ=' })).not.toThrow(
      /c2hvcnQ/,
    );
  });
});
