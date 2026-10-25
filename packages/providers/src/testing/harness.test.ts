import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useMswServer } from './msw';

const server = useMswServer(
  http.get('https://platform.test/ok', () => HttpResponse.json({ hello: 'world' })),
);

describe('MSW harness', () => {
  it('serves handlers', async () => {
    const res = await fetch('https://platform.test/ok');
    expect(await res.json()).toEqual({ hello: 'world' });
  });

  it('lets a test override a handler, e.g. to return 429 with Retry-After', async () => {
    server.use(
      http.get('https://platform.test/ok', () =>
        HttpResponse.json(
          { error: 'slow down' },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
      ),
    );
    const res = await fetch('https://platform.test/ok');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
  });

  it('fails any request without a handler, so tests never reach the network', async () => {
    await expect(fetch('https://bsky.social/xrpc/anything')).rejects.toThrow();
  });
});
