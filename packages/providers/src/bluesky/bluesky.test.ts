import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { InvalidGrantError, type PublishStep } from '@queuesprout/shared';
import { ConnectError } from '../contract';
import { buildPublishContext, loadFixture, TEST_NOW, useMswServer } from '../testing';
import { blueskyAdapter } from '.';
import { connectWithSecret, jwtExpiry, normalizeHandle } from './auth';
import { buildFacets, findLinks, findMentions, findTags } from './facets';
import { itemRecordKey } from './publish';
import type { BlueskySettings } from './settings';

const FIXTURES = fileURLToPath(new URL('./__fixtures__', import.meta.url));
const fixture = <T = Record<string, unknown>>(name: string) => loadFixture<T>(FIXTURES, name);

const PDS = 'https://pds.test';
const ENTRYWAY = 'https://bsky.social';
const DID = 'did:plc:qs7test4fixture2acct';
const APP_PASSWORD = 'abcd-efgh-ijkl-mnop';
const xrpcUrl = (service: string, nsid: string) => `${service}/xrpc/${nsid}`;

const server = useMswServer();

const ctx = (input: Parameters<typeof buildPublishContext<BlueskySettings>>[0] = {}) =>
  buildPublishContext<BlueskySettings>({
    account: { externalId: DID, serviceUrl: PDS },
    ...input,
  });

/** Records every createRecord body and answers with the fixture's uri for that rkey. */
function captureCreates() {
  const bodies: {
    repo: string;
    collection: string;
    rkey: string;
    record: Record<string, unknown>;
  }[] = [];
  const auth: (string | null)[] = [];
  server.use(
    http.post(xrpcUrl(PDS, 'com.atproto.repo.createRecord'), async ({ request }) => {
      const body = (await request.json()) as (typeof bodies)[number];
      bodies.push(body);
      auth.push(request.headers.get('authorization'));
      const created = fixture<{ uri: string; cid: string }>('createRecord');
      return HttpResponse.json({ ...created, uri: created.uri.replace('RKEY', body.rkey) });
    }),
  );
  return { bodies, auth };
}

const errorResponse = (name: string, status: number, headers?: Record<string, string>) =>
  HttpResponse.json(fixture(name), { status, headers });

describe('validate()', () => {
  const v = (bodies: string[], settings: BlueskySettings = {}) =>
    blueskyAdapter
      .validate(ctx({ bodies, settings }).post, [])
      .filter((i) => i.severity === 'error');

  it.each([
    ['a short post', ['Hello Bluesky'], []],
    ['exactly 300 graphemes', ['x'.repeat(300)], []],
    ['301 graphemes', ['x'.repeat(301)], ['text_too_long']],
    ['300 emoji over 3,000 bytes', ['👩‍👩‍👧'.repeat(300)], ['text_too_many_bytes']],
    ['an empty post', ['   '], ['empty']],
    ['a 25-post thread', Array.from({ length: 25 }, (_, i) => `post ${i}`), []],
    ['a 26-post thread', Array.from({ length: 26 }, (_, i) => `post ${i}`), ['thread_too_long']],
  ])('%s', (_name, bodies, codes) => {
    expect(v(bodies).map((i) => i.code)).toEqual(codes);
  });

  it('checks language settings', () => {
    expect(v(['hi'], { langs: ['en', 'pt-BR'] })).toEqual([]);
    expect(v(['hi'], { langs: ['english'] }).map((i) => i.code)).toEqual(['invalid_setting']);
    expect(v(['hi'], { langs: ['en', 'de', 'fr', 'es'] }).map((i) => i.code)).toEqual([
      'invalid_setting',
    ]);
  });
});

describe('facets', () => {
  it('finds links without trailing punctuation', () => {
    expect(findLinks('Read https://queuesprout.com/docs. Or (https://example.com/a)!')).toEqual([
      { start: 5, end: 33, uri: 'https://queuesprout.com/docs' },
      { start: 39, end: 60, uri: 'https://example.com/a' },
    ]);
  });

  it('finds mentions with a domain and hashtags that are not just digits', () => {
    expect(
      findMentions('hi @alice.bsky.social and @bob, mail a@b.com').map((m) => m.handle),
    ).toEqual(['alice.bsky.social']);
    expect(findTags('#launch day #2026 #QueueSprout!').map((t) => t.tag)).toEqual([
      'launch',
      'QueueSprout',
    ]);
  });

  it('uses UTF-8 byte offsets, so emoji before a link shift it', async () => {
    const text = '🌱 https://queuesprout.com @friend.bsky.social #oss';
    const facets = await buildFacets(text, async () => 'did:plc:friend');
    expect(facets).toEqual([
      {
        index: { byteStart: 5, byteEnd: 28 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://queuesprout.com' }],
      },
      {
        index: { byteStart: 29, byteEnd: 48 },
        features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:friend' }],
      },
      {
        index: { byteStart: 49, byteEnd: 53 },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'oss' }],
      },
    ]);
    // Byte ranges point at the right text.
    const bytes = new TextEncoder().encode(text);
    const slice = (f: { index: { byteStart: number; byteEnd: number } }) =>
      new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
    expect(facets.map(slice)).toEqual(['https://queuesprout.com', '@friend.bsky.social', '#oss']);
  });

  it('leaves mentions it cannot resolve as plain text', async () => {
    expect(await buildFacets('hi @nobody.example', async () => null)).toEqual([]);
  });
});

describe('record keys', () => {
  it('are valid TIDs, stable per item and different across items', () => {
    const item = { id: 'item-1', createdAt: new Date('2026-10-25T12:00:00Z') };
    const key = itemRecordKey(item, TEST_NOW);
    expect(key).toMatch(/^[234567a-j][234567a-z]{12}$/);
    expect(itemRecordKey(item, new Date())).toBe(key);
    expect(itemRecordKey({ ...item, id: 'item-2' }, TEST_NOW)).not.toBe(key);
  });
});

describe('connectWithSecret()', () => {
  const connect = (secret = APP_PASSWORD, identifier = '@QueueSprout-Test') =>
    connectWithSecret({
      identifier,
      secret,
      signal: new AbortController().signal,
    });

  it('signs in at the entryway, then talks to the account PDS', async () => {
    let signIn: unknown;
    server.use(
      http.post(xrpcUrl(ENTRYWAY, 'com.atproto.server.createSession'), async ({ request }) => {
        signIn = await request.json();
        return HttpResponse.json(fixture('createSession'));
      }),
      http.get(xrpcUrl(PDS, 'app.bsky.actor.getProfile'), ({ request }) => {
        expect(new URL(request.url).searchParams.get('actor')).toBe(DID);
        return HttpResponse.json(fixture('getProfile'));
      }),
    );
    const account = await connect();
    expect(signIn).toEqual({ identifier: 'queuesprout-test.bsky.social', password: APP_PASSWORD });
    expect(account).toMatchObject({
      externalAccountId: DID,
      displayName: '@queuesprout-test.bsky.social',
      serviceUrl: PDS,
      creds: { scopes: ['app_password'] },
      targets: [
        {
          targetType: 'profile',
          externalTargetId: DID,
          name: 'QueueSprout Test',
          handle: '@queuesprout-test.bsky.social',
        },
      ],
    });
    const session = fixture<{ accessJwt: string }>('createSession');
    expect(account.creds.expiresAt).toEqual(jwtExpiry(session.accessJwt));
    expect(account.creds.expiresAt?.getTime()).toBeGreaterThan(0);
  });

  it('refuses the account password before calling Bluesky', async () => {
    await expect(connect('my-real-password')).rejects.toBeInstanceOf(ConnectError);
  });

  it.each(['http://pds.example.com', 'https://10.0.0.5', 'https://localhost:2583'])(
    'refuses to sign in at %s',
    async (instanceUrl) => {
      await expect(
        connectWithSecret({
          identifier: 'alice.example.com',
          secret: APP_PASSWORD,
          instanceUrl,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: 'rejected' });
    },
  );

  it('refuses an account whose DID document points at a private server', async () => {
    const session = fixture<{ didDoc: { service: { serviceEndpoint: string }[] } }>(
      'createSession',
    );
    server.use(
      http.post(xrpcUrl(ENTRYWAY, 'com.atproto.server.createSession'), () =>
        HttpResponse.json({
          ...session,
          didDoc: {
            ...session.didDoc,
            service: session.didDoc.service.map((s) => ({
              ...s,
              serviceEndpoint: 'https://169.254.169.254',
            })),
          },
        }),
      ),
    );
    await expect(connect()).rejects.toMatchObject({ code: 'rejected' });
  });

  it('turns a bad password into a message safe to show', async () => {
    server.use(
      http.post(xrpcUrl(ENTRYWAY, 'com.atproto.server.createSession'), () =>
        errorResponse('error-authentication-required', 401),
      ),
    );
    const error = await connect().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect(error).toMatchObject({ code: 'invalid_credentials' });
    expect((error as Error).message).not.toContain(APP_PASSWORD);
  });

  it('reports rate limits on sign-in', async () => {
    server.use(
      http.post(xrpcUrl(ENTRYWAY, 'com.atproto.server.createSession'), () =>
        errorResponse('error-rate-limit', 429),
      ),
    );
    await expect(connect()).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('still connects when the profile cannot be read', async () => {
    server.use(
      http.post(xrpcUrl(ENTRYWAY, 'com.atproto.server.createSession'), () =>
        HttpResponse.json(fixture('createSession')),
      ),
      http.get(xrpcUrl(PDS, 'app.bsky.actor.getProfile'), () =>
        errorResponse('error-internal', 500),
      ),
    );
    expect((await connect()).targets).toEqual([
      expect.objectContaining({ name: '@queuesprout-test.bsky.social', externalTargetId: DID }),
    ]);
  });

  it('normalizes handles', () => {
    expect(normalizeHandle(' @Alice ')).toBe('alice.bsky.social');
    expect(normalizeHandle('alice.example.com')).toBe('alice.example.com');
  });
});

describe('refreshToken()', () => {
  const account = { externalId: DID, serviceUrl: PDS };
  const creds = ctx().creds;

  it('rotates both tokens at the account PDS with the refresh token', async () => {
    let bearer: string | null = null;
    server.use(
      http.post(xrpcUrl(PDS, 'com.atproto.server.refreshSession'), ({ request }) => {
        bearer = request.headers.get('authorization');
        return HttpResponse.json(fixture('refreshSession'));
      }),
    );
    const next = await blueskyAdapter.refreshToken(creds, new AbortController().signal, account);
    const fresh = fixture<{ accessJwt: string; refreshJwt: string }>('refreshSession');
    expect(bearer).toBe('Bearer test-refresh-token');
    expect(next).toEqual({
      accessToken: fresh.accessJwt,
      refreshToken: fresh.refreshJwt,
      expiresAt: jwtExpiry(fresh.accessJwt),
      scopes: ['app_password'],
    });
  });

  it.each([
    ['an expired refresh token', 'error-expired-token', 400],
    ['a revoked app password', 'error-invalid-token', 400],
    ['a 401', 'error-authentication-required', 401],
  ])('throws InvalidGrantError for %s', async (_name, body, status) => {
    server.use(
      http.post(xrpcUrl(PDS, 'com.atproto.server.refreshSession'), () =>
        errorResponse(body, status),
      ),
    );
    await expect(
      blueskyAdapter.refreshToken(creds, new AbortController().signal, account),
    ).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('throws a plain error for outages, so the account stays connected', async () => {
    server.use(
      http.post(xrpcUrl(PDS, 'com.atproto.server.refreshSession'), () =>
        errorResponse('error-internal', 502),
      ),
    );
    const error = await blueskyAdapter
      .refreshToken(creds, new AbortController().signal, account)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(InvalidGrantError);
  });
});

describe('publish()', () => {
  it('creates the post with a stable record key, facets and the access token', async () => {
    const { bodies, auth } = captureCreates();
    const c = ctx({
      bodies: ['Launch day 🌱 https://queuesprout.com #oss'],
      settings: { langs: ['en'] },
    });
    const step = await blueskyAdapter.publish(c);

    const rkey = itemRecordKey(c.item, TEST_NOW);
    expect(step).toEqual({
      kind: 'done',
      externalId: `at://${DID}/app.bsky.feed.post/${rkey}`,
      url: `https://bsky.app/profile/${DID}/post/${rkey}`,
      meta: {
        uri: `at://${DID}/app.bsky.feed.post/${rkey}`,
        cid: fixture<{ cid: string }>('createRecord').cid,
      },
    });
    expect(auth).toEqual(['Bearer test-access-token']);
    expect(bodies[0]).toMatchObject({
      repo: DID,
      collection: 'app.bsky.feed.post',
      rkey,
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Launch day 🌱 https://queuesprout.com #oss',
        createdAt: TEST_NOW.toISOString(),
        langs: ['en'],
        facets: [
          expect.objectContaining({
            features: [expect.objectContaining({ uri: 'https://queuesprout.com' })],
          }),
          expect.objectContaining({ features: [expect.objectContaining({ tag: 'oss' })] }),
        ],
      },
    });
    expect(bodies[0]?.record).not.toHaveProperty('reply');
  });

  it('replies to the root and the previous post for thread items', async () => {
    const { bodies } = captureCreates();
    const root = {
      externalId: 'at://root',
      url: null,
      meta: { uri: 'at://root', cid: 'cid-root' },
    };
    const parent = { externalId: 'at://p', url: null, meta: { uri: 'at://p', cid: 'cid-p' } };
    const step = await blueskyAdapter.publish(
      ctx({ bodies: ['one', 'two', 'three'], position: 2, root, parent }),
    );
    expect(step.kind).toBe('done');
    expect(bodies[0]?.record.reply).toEqual({
      root: { uri: 'at://root', cid: 'cid-root' },
      parent: { uri: 'at://p', cid: 'cid-p' },
    });
  });

  it('runs a whole thread, each item replying to the one before', async () => {
    const { bodies } = captureCreates();
    const items = ['one', 'two', 'three'];
    const refs: { externalId: string; url: string | null; meta: Record<string, unknown> }[] = [];
    for (let position = 0; position < items.length; position++) {
      const step = await blueskyAdapter.publish(
        ctx({
          bodies: items,
          position,
          root: refs[0] ?? null,
          parent: refs[position - 1] ?? null,
        }),
      );
      if (step.kind !== 'done') throw new Error(`step ${position} was ${step.kind}`);
      refs.push({ externalId: step.externalId, url: step.url, meta: step.meta ?? {} });
    }
    expect(bodies.map((b) => b.record.text)).toEqual(items);
    expect(new Set(bodies.map((b) => b.rkey)).size).toBe(3);
    expect(bodies[2]?.record.reply).toEqual({
      root: refs[0]?.meta,
      parent: refs[1]?.meta,
    });
  });

  it('refuses a reply without the previous post reference', async () => {
    const step = await blueskyAdapter.publish(ctx({ bodies: ['one', 'two'], position: 1 }));
    expect(step).toMatchObject({ kind: 'error', errorKind: 'validation' });
  });

  it('resolves mentions and leaves unknown handles as text', async () => {
    const { bodies } = captureCreates();
    server.use(
      http.get(xrpcUrl(PDS, 'com.atproto.identity.resolveHandle'), ({ request }) => {
        const handle = new URL(request.url).searchParams.get('handle');
        return handle === 'friend.bsky.social'
          ? HttpResponse.json(fixture('resolveHandle'))
          : errorResponse('error-invalid-request', 400);
      }),
    );
    await blueskyAdapter.publish(ctx({ bodies: ['hi @friend.bsky.social and @ghost.example'] }));
    expect(bodies[0]?.record.facets).toEqual([
      {
        index: { byteStart: 3, byteEnd: 22 },
        features: [
          {
            $type: 'app.bsky.richtext.facet#mention',
            did: fixture<{ did: string }>('resolveHandle').did,
          },
        ],
      },
    ]);
  });

  it('does not post twice when a retry finds the record already created', async () => {
    const c = ctx({ bodies: ['only once'] });
    const rkey = itemRecordKey(c.item, TEST_NOW);
    let creates = 0;
    server.use(
      http.post(xrpcUrl(PDS, 'com.atproto.repo.createRecord'), () => {
        creates++;
        return errorResponse('error-invalid-request', 400);
      }),
      http.get(xrpcUrl(PDS, 'com.atproto.repo.getRecord'), ({ request }) => {
        expect(new URL(request.url).searchParams.get('rkey')).toBe(rkey);
        return HttpResponse.json({
          uri: `at://${DID}/app.bsky.feed.post/${rkey}`,
          cid: 'cid-existing',
          value: { $type: 'app.bsky.feed.post', text: 'only once' },
        });
      }),
    );
    const step = await blueskyAdapter.publish(c);
    expect(step).toMatchObject({ kind: 'done', meta: { cid: 'cid-existing' } });
    expect(creates).toBe(1);
  });

  it('reports a real rejection when the existing record is something else', async () => {
    server.use(
      http.post(xrpcUrl(PDS, 'com.atproto.repo.createRecord'), () =>
        errorResponse('error-invalid-request', 400),
      ),
      http.get(xrpcUrl(PDS, 'com.atproto.repo.getRecord'), () =>
        errorResponse('error-invalid-request', 400),
      ),
    );
    const step = await blueskyAdapter.publish(ctx());
    expect(step).toMatchObject({ kind: 'error', errorKind: 'validation' });
    expect((step as { message: string }).message).toContain('300 graphemes');
  });

  const failWith = async (response: () => Response): Promise<PublishStep> => {
    server.use(http.post(xrpcUrl(PDS, 'com.atproto.repo.createRecord'), response));
    return blueskyAdapter.publish(ctx());
  };

  it('maps 401 to auth', async () => {
    expect(await failWith(() => errorResponse('error-authentication-required', 401))).toMatchObject(
      {
        kind: 'error',
        errorKind: 'auth',
      },
    );
  });

  it('treats an early-expired access token as transient, so the retry refreshes it', async () => {
    expect(await failWith(() => errorResponse('error-expired-token', 400))).toMatchObject({
      errorKind: 'transient',
    });
  });

  it('maps 429 with Retry-After to rate_limit', async () => {
    expect(
      await failWith(() => errorResponse('error-rate-limit', 429, { 'Retry-After': '30' })),
    ).toMatchObject({ kind: 'error', errorKind: 'rate_limit', retryAfterMs: 30_000 });
  });

  it('uses ratelimit-reset when there is no Retry-After', async () => {
    const reset = String(TEST_NOW.getTime() / 1000 + 120);
    expect(
      await failWith(() => errorResponse('error-rate-limit', 429, { 'ratelimit-reset': reset })),
    ).toMatchObject({ errorKind: 'rate_limit', retryAfterMs: 120_000 });
  });

  it.each([500, 502, 503])('maps %i to transient', async (status) => {
    expect(await failWith(() => errorResponse('error-internal', status))).toMatchObject({
      errorKind: 'transient',
      raw: { status },
    });
  });

  it('maps network failures and timeouts to transient: the record key makes retries safe', async () => {
    expect(await failWith(() => HttpResponse.error())).toMatchObject({ errorKind: 'transient' });

    server.use(
      http.post(xrpcUrl(PDS, 'com.atproto.repo.createRecord'), () => new Promise(() => {})),
    );
    const step = await blueskyAdapter.publish(ctx({ signal: AbortSignal.timeout(20) }));
    expect(step).toMatchObject({ kind: 'error', errorKind: 'transient' });
  });

  it('never puts a token in an error', async () => {
    const step = await failWith(() => errorResponse('error-authentication-required', 401));
    expect(JSON.stringify(step)).not.toContain('test-access-token');
  });

  it('never calls a stored server address that is not public https', async () => {
    const step = await blueskyAdapter.publish(
      ctx({ account: { externalId: DID, serviceUrl: 'https://127.0.0.1:2583' } }),
    );
    expect(step).toMatchObject({ kind: 'error', errorKind: 'validation' });
  });

  it('fails validation without calling Bluesky', async () => {
    const step = await blueskyAdapter.publish(ctx({ bodies: ['x'.repeat(301)] }));
    expect(step).toMatchObject({ kind: 'error', errorKind: 'validation' });
  });
});
