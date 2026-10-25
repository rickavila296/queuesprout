import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyHandler } from 'msw';
import { setupServer, type SetupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

/**
 * Starts an MSW server for the current test file. Any request without a handler
 * fails the test, so adapter tests can never reach a real platform.
 */
export function useMswServer(...handlers: AnyHandler[]): SetupServer {
  const server = setupServer(...handlers);
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}

/** Reads a recorded response from an adapter's __fixtures__ folder. */
export function loadFixture<T = unknown>(fixturesDir: string, name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as T;
}
