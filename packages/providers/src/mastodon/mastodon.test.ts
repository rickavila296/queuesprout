import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { PublishStep } from '@queuesprout/shared';
import { ConnectError } from '../contract';
import { buildPublishContext, loadFixture, TEST_NOW, useMswServer } from '../testing';
import { mastodonAdapter } from '.';
import { exchangeCode, getAuthUrl, registerApp } from './auth';
import { normalizeInstance } from './http';
import { SCOPES } from './limits';
import { idempotencyKey } from './publish';
import type { MastodonSettings } from './settings';
import { mastodonLength } from './validate';

const FIXTURES = fileURLToPath(new URL('./__fixtures__', import.meta.url));
const fixture = <T = Record<string, unknown>>(name: string) => loadFixture<T>(FIXTURES, name);

const INSTANCE = 'https://masto.test';
const REDIRECT = 'http://localhost:3000/api/oauth/mastodon/callback';
const api = (path: string) => `${INSTANCE}${path}`;
const signal = () => new AbortController().signal;

const server = useMswServer();

const ctx = (input: Parameters<typeof buildPublishContext<MastodonSettings>>[0] = {}) =>
  buildPublishContext<MastodonSettings>({
    provider: 'mastodon',
    account: { externalId: '109876543210@masto.test', serviceUrl: INSTANCE },
    ...input,
  });

const errorResponse = (name: string, status: number, headers?: Record<string, string>) =>
  HttpResponse.json(fixture(name), { status, headers });

/** Records every status request and answers with ids 1, 2, 3... */
function captureStatuses() {
  const requests: { body: Record<string, unknown>; key: string | null; auth: string | null }[] = [];
  server.use(
    http.post(api('/api/v1/statuses'), async ({ request }) => {
      requests.push({
        body: (await request.json()) as Record<string, unknown>,
        key: request.headers.get('idempotency-key'),
        auth: request.headers.get('authorization'),
      });
      const id = String(requests.length);
      return HttpResponse.json({
        ...fixture<Record<string, unknown>>('status'),
        id,
        url: `${INSTANCE}/@queuesprout_test/${id}`,
      });
    }),
  );
  return requests;
}

describe('validate()', () => {
  const v = (bodies: string[], settings: MastodonSettings = {}) =>
    mastodonAdapter
      .validate(ctx({ bodies, settings }).post, [])
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);

  it.each([
    ['a short post', ['Hello fediverse'], []],
    ['exactly 500 characters', ['x'.repeat(500)], []],
    ['501 characters', ['x'.repeat(501)], ['text_too_long']],
    [
      'a long link that counts as 23',
      ['x'.repeat(470) + ' https://example.com/' + 'a'.repeat(200)],
      [],
    ],
    ['an empty post', [' '], ['empty']],
    ['a 26-post thread', Array.from({ length: 26 }, (_, i) => `post ${i}`), ['thread_too_long']],
  ])('%s', (_name, bodies, codes) => {
    expect(v(bodies)).toEqual(codes);
  });

  it('counts the content warning against the limit', () => {
    expect(v(['x'.repeat(480)], { spoilerText: 'x'.repeat(20) })).toEqual([]);
    expect(v(['x'.repeat(481)], { spoilerText: 'x'.repeat(20) })).toEqual(['text_too_long']);
  });

  it('checks settings', () => {
    expect(v(['hi'], { visibility: 'unlisted', language: 'en' })).toEqual([]);
    expect(v(['hi'], { visibility: 'direct' as 'public' })).toEqual(['invalid_setting']);
    expect(v(['hi'], { language: 'english' })).toEqual(['invalid_setting']);
  });

  it('counts links as 23 characters and remote mentions by username only', () => {
    expect(mastodonLength('https://example.com/a/very/long/path/that/goes/on')).toBe(23);
    expect(mastodonLength('hi @alice@mastodon.social')).toBe('hi @alice'.length);
    expect(mastodonLength('🌱')).toBe(1);
  });
});

describe('normalizeInstance()', () => {
  it.each([
    ['mastodon.social', 'https://mastodon.social'],
    ['https://Mastodon.Social/@me', 'https://mastodon.social'],
    ['@me@hachyderm.io', 'https://hachyderm.io'],
    ['me@fosstodon.org', 'https://fosstodon.org'],
    ['http://mastodon.social', null],
    ['localhost:3000', null],
    ['10.0.0.2', null],
    ['not a server', null],
  ])('%s → %s', (input, expected) => {
    expect(normalizeInstance(input)).toBe(expected);
  });
});

describe('connecting', () => {
  it('registers one app on the instance with the scopes it needs', async () => {
    let body: unknown;
    server.use(
      http.post(api('/api/v1/apps'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(fixture('app'));
      }),
    );
    const app = await registerApp({
      instanceUrl: 'masto.test',
      redirectUri: REDIRECT,
      clientName: 'QueueSprout',
      website: 'https://queuesprout.com',
      signal: signal(),
    });
    expect(app).toEqual({ clientId: 'test-client-id', clientSecret: 'test-client-secret' });
    expect(body).toEqual({
      client_name: 'QueueSprout',
      redirect_uris: REDIRECT,
      scopes: SCOPES,
      website: 'https://queuesprout.com',
    });
  });

  it('refuses private or plain-http servers before any request', async () => {
    await expect(
      registerApp({
        instanceUrl: 'http://192.168.1.5',
        redirectUri: REDIRECT,
        clientName: 'QueueSprout',
        website: 'https://queuesprout.com',
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: 'rejected' });
  });

  it('builds the authorize URL with state and a PKCE S256 challenge', async () => {
    const start = await getAuthUrl({
      state: 'state-123',
      redirectUri: REDIRECT,
      clientId: 'test-client-id',
      instanceUrl: INSTANCE,
    });
    const url = new URL(start.url);
    expect(url.origin + url.pathname).toBe(`${INSTANCE}/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'test-client-id',
      redirect_uri: REDIRECT,
      scope: SCOPES,
      state: 'state-123',
      code_challenge_method: 'S256',
    });
    expect(start.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(start.codeVerifier),
    );
    expect(url.searchParams.get('code_challenge')).toBe(Buffer.from(digest).toString('base64url'));
  });

  it('exchanges the code and reads the profile', async () => {
    let tokenBody: unknown;
    let bearer: string | null = null;
    server.use(
      http.post(api('/oauth/token'), async ({ request }) => {
        tokenBody = await request.json();
        return HttpResponse.json(fixture('token'));
      }),
      http.get(api('/api/v1/accounts/verify_credentials'), ({ request }) => {
        bearer = request.headers.get('authorization');
        return HttpResponse.json(fixture('verifyCredentials'));
      }),
    );
    const account = await exchangeCode({
      code: 'code-1',
      redirectUri: REDIRECT,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      codeVerifier: 'verifier-1',
      instanceUrl: INSTANCE,
      signal: signal(),
    });
    expect(tokenBody).toMatchObject({
      grant_type: 'authorization_code',
      code: 'code-1',
      client_secret: 'test-client-secret',
      code_verifier: 'verifier-1',
    });
    expect(bearer).toBe('Bearer test-mastodon-token');
    expect(account).toEqual({
      externalAccountId: '109876543210@masto.test',
      displayName: '@queuesprout_test@masto.test',
      serviceUrl: INSTANCE,
      creds: {
        accessToken: 'test-mastodon-token',
        refreshToken: null,
        expiresAt: null,
        scopes: ['read:accounts', 'write:statuses', 'write:media'],
      },
      targets: [
        {
          targetType: 'profile',
          externalTargetId: '109876543210',
          name: 'QueueSprout Test',
          handle: '@queuesprout_test@masto.test',
          avatarUrl: 'https://files.masto.test/accounts/avatars/original/missing.png',
        },
      ],
    });
  });

  it('turns a used or expired code into a message safe to show', async () => {
    server.use(http.post(api('/oauth/token'), () => errorResponse('error-invalid-grant', 400)));
    const error = await exchangeCode({
      code: 'old',
      redirectUri: REDIRECT,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      instanceUrl: INSTANCE,
      signal: signal(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect(error).toMatchObject({ code: 'rejected' });
    expect((error as Error).message).not.toContain('test-client-secret');
  });

  it('keeps the token as is on refresh: Mastodon tokens do not expire', async () => {
    const creds = ctx().creds;
    expect(await mastodonAdapter.refreshToken(creds, signal(), ctx().account)).toBe(creds);
  });
});

describe('publish()', () => {
  it('posts the status with an idempotency key, settings and the token', async () => {
    const requests = captureStatuses();
    const c = ctx({
      bodies: ['Hello fediverse'],
      settings: { visibility: 'unlisted', spoilerText: 'launch', language: 'en' },
    });
    const step = await mastodonAdapter.publish(c);
    expect(step).toEqual({
      kind: 'done',
      externalId: '1',
      url: `${INSTANCE}/@queuesprout_test/1`,
      meta: { id: '1' },
    });
    expect(requests).toEqual([
      {
        body: {
          status: 'Hello fediverse',
          visibility: 'unlisted',
          spoiler_text: 'launch',
          sensitive: true,
          language: 'en',
        },
        key: idempotencyKey(c.item),
        auth: 'Bearer test-access-token',
      },
    ]);
  });

  it('runs a whole thread, each item replying to the one before', async () => {
    const requests = captureStatuses();
    const items = ['one', 'two', 'three'];
    const refs: { externalId: string; url: string | null; meta: Record<string, unknown> }[] = [];
    for (let position = 0; position < items.length; position++) {
      const step = await mastodonAdapter.publish(
        ctx({ bodies: items, position, root: refs[0] ?? null, parent: refs[position - 1] ?? null }),
      );
      if (step.kind !== 'done') throw new Error(`step ${position} was ${step.kind}`);
      refs.push({ externalId: step.externalId, url: step.url, meta: step.meta ?? {} });
    }
    expect(requests.map((r) => [r.body.status, r.body.in_reply_to_id])).toEqual([
      ['one', undefined],
      ['two', '1'],
      ['three', '2'],
    ]);
    expect(new Set(requests.map((r) => r.key)).size).toBe(3);
  });

  it('sends the same idempotency key on a retry, so the server returns the first post', async () => {
    const requests = captureStatuses();
    const c = ctx();
    await mastodonAdapter.publish(c);
    await mastodonAdapter.publish(c);
    expect(requests[0]?.key).toBe(requests[1]?.key);
    expect(requests[0]?.key).toBe('queuesprout-item-0');
  });

  it('refuses a reply without the previous post reference', async () => {
    expect(await mastodonAdapter.publish(ctx({ bodies: ['a', 'b'], position: 1 }))).toMatchObject({
      kind: 'error',
      errorKind: 'validation',
    });
  });

  it('asks for a reconnect when the account has no server address', async () => {
    expect(
      await mastodonAdapter.publish(ctx({ account: { externalId: 'x', serviceUrl: null } })),
    ).toMatchObject({ kind: 'error', errorKind: 'auth' });
  });

  const failWith = async (response: () => Response): Promise<PublishStep> => {
    server.use(http.post(api('/api/v1/statuses'), response));
    return mastodonAdapter.publish(ctx());
  };

  it('maps 401 and 403 to auth', async () => {
    expect(await failWith(() => errorResponse('error-unauthorized', 401))).toMatchObject({
      errorKind: 'auth',
    });
    expect(await failWith(() => errorResponse('error-forbidden', 403))).toMatchObject({
      errorKind: 'auth',
    });
  });

  it('maps 422 and 404 to validation with the server message', async () => {
    expect(await failWith(() => errorResponse('error-unprocessable', 422))).toMatchObject({
      errorKind: 'validation',
      message: expect.stringContaining('character limit'),
    });
    expect(await failWith(() => errorResponse('error-not-found', 404))).toMatchObject({
      errorKind: 'validation',
    });
  });

  it('maps 429 with Retry-After to rate_limit', async () => {
    expect(
      await failWith(() => errorResponse('error-rate-limit', 429, { 'Retry-After': '45' })),
    ).toMatchObject({ errorKind: 'rate_limit', retryAfterMs: 45_000 });
  });

  it('uses X-RateLimit-Reset when there is no Retry-After', async () => {
    const reset = new Date(TEST_NOW.getTime() + 300_000).toISOString();
    expect(
      await failWith(() => errorResponse('error-rate-limit', 429, { 'X-RateLimit-Reset': reset })),
    ).toMatchObject({ errorKind: 'rate_limit', retryAfterMs: 300_000 });
  });

  it.each([500, 502, 503])('maps %i to transient', async (status) => {
    expect(
      await failWith(() => new HttpResponse('<html>Bad gateway</html>', { status })),
    ).toMatchObject({ errorKind: 'transient', raw: { status } });
  });

  it('maps network failures and timeouts to transient', async () => {
    expect(await failWith(() => HttpResponse.error())).toMatchObject({ errorKind: 'transient' });
    server.use(http.post(api('/api/v1/statuses'), () => new Promise(() => {})));
    expect(await mastodonAdapter.publish(ctx({ signal: AbortSignal.timeout(20) }))).toMatchObject({
      kind: 'error',
      errorKind: 'transient',
    });
  });

  it('never calls a stored server address that is not public https', async () => {
    expect(
      await mastodonAdapter.publish(
        ctx({ account: { externalId: 'x', serviceUrl: 'https://127.0.0.1' } }),
      ),
    ).toMatchObject({ kind: 'error', errorKind: 'validation' });
  });

  it('never puts a token in an error', async () => {
    const step = await failWith(() => errorResponse('error-unauthorized', 401));
    expect(JSON.stringify(step)).not.toContain('test-access-token');
  });

  it('fails validation without calling the server', async () => {
    expect(await mastodonAdapter.publish(ctx({ bodies: ['x'.repeat(501)] }))).toMatchObject({
      kind: 'error',
      errorKind: 'validation',
    });
  });
});

describe('publish() with images', () => {
  const TWO = [
    { id: 'm1', alt: 'A green square' },
    { id: 'm2', alt: '' },
  ];

  /** Answers uploads with ids 101, 102... ready unless listed in processing. */
  function captureUploads(processing: string[] = []) {
    const uploads: { name: string; type: string; size: number; description: string | null }[] = [];
    server.use(
      http.post(api('/api/v2/media'), async ({ request }) => {
        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File))
          return HttpResponse.json({ error: 'no file' }, { status: 422 });
        uploads.push({
          name: file.name,
          type: file.type,
          size: file.size,
          description: form.get('description') as string | null,
        });
        const id = String(100 + uploads.length);
        const pending = processing.includes(id);
        return HttpResponse.json(
          { ...fixture<Record<string, unknown>>(pending ? 'media-processing' : 'media'), id },
          { status: pending ? 202 : 200 },
        );
      }),
    );
    return uploads;
  }

  it('uploads each image with its alt text, then posts with the media ids in order', async () => {
    const uploads = captureUploads();
    const statuses = captureStatuses();
    const step = await mastodonAdapter.publish(ctx({ media: [TWO] }));
    expect(step).toMatchObject({ kind: 'done', externalId: '1' });
    expect(uploads).toEqual([
      { name: 'image-1.png', type: 'image/png', size: 11, description: 'A green square' },
      { name: 'image-2.png', type: 'image/png', size: 11, description: null },
    ]);
    expect(statuses[0]?.body.media_ids).toEqual(['101', '102']);
  });

  it('posts images with no text', async () => {
    captureUploads();
    const statuses = captureStatuses();
    expect(await mastodonAdapter.publish(ctx({ bodies: [''], media: [TWO] }))).toMatchObject({
      kind: 'done',
    });
    expect(statuses[0]?.body).toMatchObject({ status: '', media_ids: ['101', '102'] });
  });

  it('waits while the server processes an upload, then posts without uploading again', async () => {
    const uploads = captureUploads(['102']);
    const statuses = captureStatuses();
    let checks = 0;
    server.use(
      http.get(api('/api/v1/media/:id'), ({ params }) => {
        checks++;
        const stillProcessing = params.id === '102' && checks <= 2;
        return HttpResponse.json(
          {
            ...fixture<Record<string, unknown>>(stillProcessing ? 'media-processing' : 'media'),
            id: params.id,
          },
          { status: stillProcessing ? 206 : 200 },
        );
      }),
    );

    const first = await mastodonAdapter.publish(ctx({ media: [TWO] }));
    expect(first).toEqual({
      kind: 'pending',
      checkpoint: {
        stage: 'media_uploaded',
        childContainerIds: ['101', '102'],
        startedAt: TEST_NOW.toISOString(),
      },
      pollAfterMs: 2000,
    });
    if (first.kind !== 'pending') return;

    // 101 is ready, 102 still processing.
    const second = await mastodonAdapter.publish(
      ctx({ media: [TWO], checkpoint: first.checkpoint }),
    );
    expect(second).toEqual(first);
    expect(statuses).toHaveLength(0);

    const third = await mastodonAdapter.publish(
      ctx({ media: [TWO], checkpoint: first.checkpoint }),
    );
    expect(third).toMatchObject({ kind: 'done' });
    expect(uploads).toHaveLength(2);
    expect(statuses[0]?.body.media_ids).toEqual(['101', '102']);
  });

  it('fits images to the Mastodon spec', async () => {
    captureUploads();
    captureStatuses();
    const specs: unknown[] = [];
    await mastodonAdapter.publish(
      ctx({
        media: [[{ id: 'm1' }]],
        resolver: {
          getFile: async (_id, spec) => {
            specs.push(spec);
            return {
              ok: true,
              file: { bytes: new Uint8Array([1]), mime: 'image/jpeg', width: 1, height: 1 },
            };
          },
        },
      }),
    );
    expect(specs).toEqual([
      {
        maxBytes: 8_000_000,
        maxEdgePx: 2880,
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      },
    ]);
  });

  it('retries while an image is still being checked, and fails one that is gone', async () => {
    const statuses = captureStatuses();
    const resolve = (retryable: boolean) =>
      mastodonAdapter.publish(
        ctx({
          media: [[{ id: 'm1' }]],
          resolver: { getFile: async () => ({ ok: false, retryable, message: 'nope' }) },
        }),
      );
    expect(await resolve(true)).toMatchObject({ kind: 'error', errorKind: 'transient' });
    expect(await resolve(false)).toMatchObject({ kind: 'error', errorKind: 'validation' });
    expect(statuses).toHaveLength(0);
  });

  it('maps upload errors like any other call', async () => {
    const statuses = captureStatuses();
    server.use(http.post(api('/api/v2/media'), () => errorResponse('error-unprocessable', 422)));
    expect(await mastodonAdapter.publish(ctx({ media: [TWO] }))).toMatchObject({
      kind: 'error',
      errorKind: 'validation',
    });
    server.use(
      http.post(api('/api/v2/media'), () =>
        errorResponse('error-rate-limit', 429, { 'retry-after': '30' }),
      ),
    );
    expect(await mastodonAdapter.publish(ctx({ media: [TWO] }))).toMatchObject({
      kind: 'error',
      errorKind: 'rate_limit',
      retryAfterMs: 30_000,
    });
    expect(statuses).toHaveLength(0);
  });

  it('maps errors while checking on processing uploads', async () => {
    server.use(http.get(api('/api/v1/media/:id'), () => new HttpResponse(null, { status: 503 })));
    const checkpoint = {
      stage: 'media_uploaded',
      childContainerIds: ['101'],
      startedAt: TEST_NOW.toISOString(),
    };
    expect(await mastodonAdapter.publish(ctx({ media: [TWO], checkpoint }))).toMatchObject({
      kind: 'error',
      errorKind: 'transient',
    });
  });

  it('validates image count and alt text length', () => {
    const codes = (media: { id: string; alt?: string }[]) =>
      mastodonAdapter
        .validate(ctx({ media: [media] }).post, [])
        .filter((i) => i.severity === 'error')
        .map((i) => i.code);
    expect(codes(TWO)).toEqual([]);
    expect(codes(Array.from({ length: 5 }, (_, i) => ({ id: `m${i}` })))).toEqual([
      'too_many_media',
    ]);
    expect(codes([{ id: 'm1', alt: 'x'.repeat(1500) }])).toEqual([]);
    expect(codes([{ id: 'm1', alt: 'x'.repeat(1501) }])).toEqual(['alt_text_too_long']);
  });
});
