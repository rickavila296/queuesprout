import { describe, expect, it } from 'vitest';
import { parseWorkerEnv } from './env';

const base = { WORKER_DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

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
});
