import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { PublishStep } from '@queuesprout/shared';
import { ConnectError } from '../contract';
import { buildPublishContext, loadFixture, useMswServer } from '../testing';
import { slackAdapter } from '.';
import { connectWithSecret } from './auth';
import { toStepError } from './errors';
import { API_URL, parseChannel } from './limits';
import { escapeText, permalink } from './publish';
import type { SlackSettings } from './settings';

const FIXTURES = fileURLToPath(new URL('./__fixtures__', import.meta.url));
const fixture = <T = Record<string, unknown>>(name: string) => loadFixture<T>(FIXTURES, name);

const TOKEN = 'xoxb-1000000000-2000000000-' + 'x'.repeat(24);
const api = (method: string) => `${API_URL}/${method}`;
const signal = () => new AbortController().signal;
const CHANNEL = 'C0000000004';
const WORKSPACE = 'https://acme-coffee.slack.com/';

const server = useMswServer();

/** Slack arguments arrive form-encoded. */
const form = async (request: Request) =>
  Object.fromEntries(new URLSearchParams(await request.text()));

const ctx = (input: Parameters<typeof buildPublishContext<SlackSettings>>[0] = {}) => {
  const c = buildPublishContext<SlackSettings>({
    provider: 'slack',
    account: { externalId: 'T0000000001/U0000000002', serviceUrl: WORKSPACE },
    ...input,
  });
  return {
    ...c,
    creds: { ...c.creds, accessToken: TOKEN, refreshToken: null },
    target: { type: 'server_channel' as const, externalId: CHANNEL },
  };
};

const reply = (name: string, status = 200, headers?: Record<string, string>) =>
  HttpResponse.json(fixture(name), { status, headers });

const connectable = (channel: object = {}) =>
  server.use(
    http.post(api('auth.test'), () => reply('auth-test')),
    http.post(api('conversations.info'), () =>
      HttpResponse.json({
        ok: true,
        channel: { ...fixture<{ channel: object }>('conversations-info').channel, ...channel },
      }),
    ),
    http.post(api('conversations.list'), () => reply('conversations-list')),
  );

const connect = (identifier: string, secret = TOKEN) =>
  connectWithSecret({ identifier, secret, signal: signal() });

describe('validate()', () => {
  const v = (bodies: string[], settings: SlackSettings = {}) =>
    slackAdapter
      .validate(ctx({ bodies, settings }).post, [])
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);

  it.each([
    ['a short message', ['Hello Slack'], []],
    ['a thread', ['one', 'two', 'three'], []],
    ['exactly 40,000 characters', ['x'.repeat(40000)], []],
    ['40,001 characters', ['x'.repeat(40001)], ['text_too_long']],
    ['an empty message', [' '], ['empty']],
  ])('%s', (_name, bodies, codes) => {
    expect(v(bodies)).toEqual(codes);
  });

  it('caps threads at 25 messages', () => {
    expect(v(Array.from({ length: 26 }, (_, i) => `m${i}`))).toContain('thread_too_long');
  });

  it('checks settings', () => {
    expect(v(['hi'], { disableUnfurl: true })).toEqual([]);
    expect(v(['hi'], { disableUnfurl: 'no' as unknown as boolean })).toEqual(['invalid_setting']);
  });
});

describe('channel input', () => {
  it.each([
    ['#announcements', { name: 'announcements' }],
    ['Announcements', { name: 'announcements' }],
    ['C0000000004', { id: 'C0000000004' }],
    [' G0123ABCD ', { id: 'G0123ABCD' }],
    ['#has space', null],
    ['https://evil.example', null],
    ['', null],
  ])('%s → %o', (input, expected) => {
    expect(parseChannel(input)).toEqual(expected);
  });
});

describe('connectWithSecret()', () => {
  it('checks the token and the channel by id, then makes one channel', async () => {
    connectable();
    let auth: string | null = null;
    let info: Record<string, string> = {};
    server.use(
      http.post(api('auth.test'), ({ request }) => {
        auth = request.headers.get('authorization');
        return reply('auth-test');
      }),
      http.post(api('conversations.info'), async ({ request }) => {
        info = await form(request);
        return reply('conversations-info');
      }),
    );
    const account = await connect(CHANNEL, ` ${TOKEN} `);
    expect(auth).toBe(`Bearer ${TOKEN}`);
    expect(info).toEqual({ channel: CHANNEL });
    expect(account).toEqual({
      externalAccountId: 'T0000000001/U0000000002',
      displayName: 'Acme Coffee',
      serviceUrl: WORKSPACE,
      creds: { accessToken: TOKEN, refreshToken: null, expiresAt: null, scopes: ['chat:write'] },
      targets: [
        {
          targetType: 'server_channel',
          externalTargetId: CHANNEL,
          name: '#announcements',
          handle: null,
        },
      ],
    });
  });

  it('finds a channel by name across pages', async () => {
    connectable();
    const cursors: (string | undefined)[] = [];
    server.use(
      http.post(api('conversations.list'), async ({ request }) => {
        const args = await form(request);
        cursors.push(args.cursor);
        if (!args.cursor) {
          return HttpResponse.json({
            ok: true,
            channels: [{ id: 'C0000000009', name: 'random', is_member: true }],
            response_metadata: { next_cursor: 'page2' },
          });
        }
        return reply('conversations-list');
      }),
    );
    const account = await connect('#announcements');
    expect(cursors).toEqual([undefined, 'page2']);
    expect(account.targets[0]?.externalTargetId).toBe(CHANNEL);
  });

  it('refuses a malformed token or channel before any request', async () => {
    await expect(connect('#announcements', 'xoxp-user-token')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    await expect(connect('https://evil.example')).rejects.toMatchObject({ code: 'rejected' });
  });

  it('turns a bad token into a message safe to show', async () => {
    server.use(http.post(api('auth.test'), () => reply('error-invalid-auth')));
    const error = await connect(CHANNEL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect(error).toMatchObject({ code: 'invalid_credentials' });
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('asks to invite the app when it is not in the channel', async () => {
    connectable({ is_member: false });
    await expect(connect(CHANNEL)).rejects.toMatchObject({
      code: 'rejected',
      message: expect.stringContaining('/invite'),
    });
  });

  it.each([
    ['an unknown channel id', 'error-channel-not-found', 'could not find'],
    ['a missing scope', 'error-missing-scope', 'channels:read'],
  ])('explains %s', async (_name, response, text) => {
    connectable();
    server.use(http.post(api('conversations.info'), () => reply(response)));
    await expect(connect(CHANNEL)).rejects.toMatchObject({
      code: 'rejected',
      message: expect.stringContaining(text),
    });
  });

  it('refuses a name it cannot find, archived channels and DMs', async () => {
    connectable();
    await expect(connect('#nope')).rejects.toMatchObject({ code: 'rejected' });
    connectable({ is_archived: true });
    await expect(connect(CHANNEL)).rejects.toMatchObject({
      message: expect.stringContaining('archived'),
    });
    connectable({ is_mpim: true });
    await expect(connect(CHANNEL)).rejects.toMatchObject({ code: 'rejected' });
  });

  it('drops a workspace URL that is not public https', async () => {
    connectable();
    server.use(
      http.post(api('auth.test'), () =>
        HttpResponse.json({
          ...fixture<Record<string, unknown>>('auth-test'),
          url: 'http://localhost/',
        }),
      ),
    );
    expect((await connect(CHANNEL)).serviceUrl).toBeNull();
  });

  it('maps 429 and outages', async () => {
    server.use(
      http.post(api('auth.test'), () =>
        HttpResponse.json({ ok: false, error: 'ratelimited' }, { status: 429 }),
      ),
    );
    await expect(connect(CHANNEL)).rejects.toMatchObject({ code: 'rate_limited' });
    server.use(http.post(api('auth.test'), () => new HttpResponse('down', { status: 503 })));
    await expect(connect(CHANNEL)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('publish()', () => {
  it('posts the first message to the channel and links to it', async () => {
    let args: Record<string, string> = {};
    server.use(
      http.post(api('chat.postMessage'), async ({ request }) => {
        args = await form(request);
        return reply('post-message');
      }),
    );
    const step = await slackAdapter.publish(
      ctx({ bodies: ['Hello Slack'], settings: { disableUnfurl: true } }),
    );
    expect(args).toEqual({
      channel: CHANNEL,
      text: 'Hello Slack',
      unfurl_links: 'false',
      unfurl_media: 'false',
    });
    expect(step).toEqual({
      kind: 'done',
      externalId: '1793000000.000100',
      url: 'https://acme-coffee.slack.com/archives/C0000000004/p1793000000000100',
      meta: { ts: '1793000000.000100', channel: CHANNEL },
    });
  });

  it('replies in the thread of the first message', async () => {
    let args: Record<string, string> = {};
    server.use(
      http.post(api('chat.postMessage'), async ({ request }) => {
        args = await form(request);
        return HttpResponse.json({ ok: true, channel: CHANNEL, ts: '1793000001.000200' });
      }),
    );
    const root = { externalId: '1793000000.000100', url: null, meta: { ts: '1793000000.000100' } };
    const base = ctx({ bodies: ['one', 'two', 'three'] });
    const step = await slackAdapter.publish({
      ...base,
      item: { ...base.item, position: 2, body: 'three' },
      root,
      parent: { externalId: '1793000000.000150', url: null, meta: { ts: '1793000000.000150' } },
    });
    expect(args.thread_ts).toBe('1793000000.000100');
    expect(step).toMatchObject({
      kind: 'done',
      url: 'https://acme-coffee.slack.com/archives/C0000000004/p1793000001000200?thread_ts=1793000000.000100&cid=C0000000004',
    });
  });

  it('refuses a reply when the first message has no reference', async () => {
    const base = ctx({ bodies: ['one', 'two'] });
    expect(
      await slackAdapter.publish({ ...base, item: { ...base.item, position: 1, body: 'two' } }),
    ).toMatchObject({ kind: 'error', errorKind: 'validation' });
  });

  it('escapes the text so it never pings @channel or @everyone', async () => {
    let text = '';
    server.use(
      http.post(api('chat.postMessage'), async ({ request }) => {
        text = (await form(request)).text ?? '';
        return reply('post-message');
      }),
    );
    await slackAdapter.publish(ctx({ bodies: ['<!channel> Q&A at 5 > 4'] }));
    expect(text).toBe('&lt;!channel&gt; Q&amp;A at 5 &gt; 4');
    expect(escapeText('plain')).toBe('plain');
  });

  it('builds links without a known workspace URL as empty', () => {
    expect(permalink(null, CHANNEL, '1.2')).toBe('');
    expect(permalink('https://x.slack.com', CHANNEL, '1.2')).toBe(
      'https://x.slack.com/archives/C0000000004/p12',
    );
  });

  const failWith = async (response: () => Response): Promise<PublishStep> => {
    server.use(http.post(api('chat.postMessage'), response));
    return slackAdapter.publish(ctx());
  };

  it.each(['error-invalid-auth', 'error-channel-not-found', 'error-not-in-channel'])(
    'maps %s to auth',
    async (name) => {
      expect(await failWith(() => reply(name))).toMatchObject({ errorKind: 'auth' });
    },
  );

  it('maps other errors to validation', async () => {
    expect(await failWith(() => reply('error-msg-too-long'))).toMatchObject({
      errorKind: 'validation',
      message: expect.stringContaining('msg_too_long'),
    });
  });

  it('maps 429 to rate_limit using Retry-After', async () => {
    expect(
      await failWith(() =>
        HttpResponse.json(
          { ok: false, error: 'ratelimited' },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
      ),
    ).toMatchObject({ errorKind: 'rate_limit', retryAfterMs: 30000 });
  });

  it('maps internal_error and 5xx to transient', async () => {
    expect(await failWith(() => reply('error-internal-error'))).toMatchObject({
      errorKind: 'transient',
    });
    for (const status of [500, 502, 503]) {
      expect(await failWith(() => new HttpResponse('error', { status }))).toMatchObject({
        errorKind: 'transient',
      });
    }
  });

  it('reports a gateway timeout as unknown: the message may exist', async () => {
    expect(await failWith(() => new HttpResponse('timeout', { status: 504 }))).toMatchObject({
      errorKind: 'unknown',
    });
  });

  it('reports a timeout as unknown, so the worker never posts twice', async () => {
    server.use(http.post(api('chat.postMessage'), () => new Promise(() => {})));
    expect(await slackAdapter.publish(ctx({ signal: AbortSignal.timeout(20) }))).toMatchObject({
      kind: 'error',
      errorKind: 'unknown',
    });
  });

  it('retries failures that happen before the request is sent', () => {
    const notSent = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    expect(toStepError(notSent)).toMatchObject({ errorKind: 'transient' });
    const dropped = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    expect(toStepError(dropped)).toMatchObject({ errorKind: 'unknown' });
  });

  it('never puts the bot token in an error', async () => {
    const step = await failWith(() => reply('error-invalid-auth'));
    expect(JSON.stringify(step)).not.toContain(TOKEN);
  });

  it('fails validation without calling Slack', async () => {
    expect(await slackAdapter.publish(ctx({ bodies: ['x'.repeat(40001)] }))).toMatchObject({
      kind: 'error',
      errorKind: 'validation',
    });
  });
});
