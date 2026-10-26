import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchFresh } from './net';

// A local server, not MSW: the point is how many TCP connections reach it.
describe('fetchFresh()', () => {
  let server: Server;
  let url: string;
  let connections = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => res.end('ok'));
    server.keepAliveTimeout = 60_000;
    server.on('connection', () => (connections += 1));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('never reuses a pooled keep-alive connection', async () => {
    connections = 0;
    for (let i = 0; i < 3; i++) {
      const { res, text } = await fetchFresh(url, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(text).toBe('ok');
    }
    expect(connections).toBe(3);
  });

  it('is needed: plain fetch reuses the idle connection', async () => {
    connections = 0;
    for (let i = 0; i < 3; i++) await (await fetch(url, { method: 'POST' })).text();
    expect(connections).toBeLessThan(3);
  });
});
