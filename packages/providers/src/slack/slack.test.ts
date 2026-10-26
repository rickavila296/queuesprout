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

describe('publish() with images', () => {
  const UPLOAD = 'https://files.slack.com/upload/v1/:ticket';
  const TWO = [
    { id: 'm1', alt: 'A green square' },
    { id: 'm2', alt: '' },
  ];

  /** Answers the upload flow with file ids F…101, F…102…; records every call. */
  function uploadFlow() {
    const seen = {
      urlRequests: [] as Record<string, string>[],
      uploads: [] as { type: string | null; size: number; auth: string | null }[],
      completed: [] as unknown[],
      messages: [] as Record<string, string>[],
    };
    server.use(
      http.post(api('files.getUploadURLExternal'), async ({ request }) => {
        seen.urlRequests.push(await form(request));
        const n = 100 + seen.urlRequests.length;
        return HttpResponse.json({
          ...fixture<Record<string, unknown>>('get-upload-url-external'),
          upload_url: `https://files.slack.com/upload/v1/ticket${n}`,
          file_id: `F0000000${n}`,
        });
      }),
      http.post(UPLOAD, async ({ request }) => {
        seen.uploads.push({
          type: request.headers.get('content-type'),
          size: (await request.arrayBuffer()).byteLength,
          auth: request.headers.get('authorization'),
        });
        return new HttpResponse('OK');
      }),
      http.post(api('files.completeUploadExternal'), async ({ request }) => {
        seen.completed.push(JSON.parse((await form(request)).files ?? '[]'));
        return reply('complete-upload-external');
      }),
      http.post(api('chat.postMessage'), async ({ request }) => {
        seen.messages.push(await form(request));
        return reply('post-message');
      }),
    );
    return seen;
  }

  it('uploads private files, then posts them as image blocks with alt text', async () => {
    const seen = uploadFlow();
    const step = await slackAdapter.publish(ctx({ bodies: ['Fresh <roast>'], media: [TWO] }));
    expect(step).toMatchObject({ kind: 'done', externalId: '1793000000.000100' });

    expect(seen.urlRequests).toEqual([
      { filename: 'image-1.png', length: '11', alt_txt: 'A green square' },
      { filename: 'image-2.png', length: '11' },
    ]);
    // The bytes go to Slack's upload host without the bot token.
    expect(seen.uploads).toEqual([
      { type: 'image/png', size: 11, auth: null },
      { type: 'image/png', size: 11, auth: null },
    ]);
    expect(seen.completed).toEqual([
      [
        { id: 'F0000000101', title: 'image-1.png' },
        { id: 'F0000000102', title: 'image-2.png' },
      ],
    ]);
    const message = seen.messages[0] ?? {};
    expect(message.channel).toBe(CHANNEL);
    expect(message.text).toBe('Fresh &lt;roast&gt;');
    expect(JSON.parse(message.blocks ?? '[]')).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: 'Fresh &lt;roast&gt;' } },
      { type: 'image', slack_file: { id: 'F0000000101' }, alt_text: 'A green square' },
      { type: 'image', slack_file: { id: 'F0000000102' }, alt_text: 'Image' },
    ]);
  });

  it('posts images with no text, and splits long text into sections', async () => {
    const seen = uploadFlow();
    await slackAdapter.publish(ctx({ bodies: [''], media: [[{ id: 'm1' }]] }));
    expect(seen.messages[0]?.text).toBe('Image');
    expect(JSON.parse(seen.messages[0]?.blocks ?? '[]')).toHaveLength(1);

    await slackAdapter.publish(ctx({ bodies: ['x'.repeat(7000)], media: [[{ id: 'm1' }]] }));
    const blocks = JSON.parse(seen.messages[1]?.blocks ?? '[]') as { type: string }[];
    expect(blocks.map((b) => b.type)).toEqual(['section', 'section', 'section', 'image']);
  });

  it('waits for Slack to process the files, then posts them without uploading again', async () => {
    const seen = uploadFlow();
    let attempts = 0;
    server.use(
      http.post(api('chat.postMessage'), async ({ request }) => {
        seen.messages.push(await form(request));
        attempts++;
        return attempts === 1 ? reply('error-invalid-blocks') : reply('post-message');
      }),
    );
    const first = await slackAdapter.publish(ctx({ media: [TWO] }));
    expect(first).toMatchObject({
      kind: 'pending',
      checkpoint: {
        stage: 'files_uploaded',
        childContainerIds: ['F0000000101', 'F0000000102'],
        data: { tries: 1 },
      },
      pollAfterMs: 2000,
    });
    if (first.kind !== 'pending') return;

    const second = await slackAdapter.publish(ctx({ media: [TWO], checkpoint: first.checkpoint }));
    expect(second).toMatchObject({ kind: 'done' });
    expect(seen.urlRequests).toHaveLength(2);
    expect(seen.completed).toHaveLength(1);
  });

  it('gives up on files that never become usable', async () => {
    uploadFlow();
    server.use(http.post(api('chat.postMessage'), () => reply('error-invalid-blocks')));
    const checkpoint = {
      stage: 'files_uploaded',
      childContainerIds: ['F0000000101'],
      startedAt: new Date().toISOString(),
      data: { tries: 9 },
    };
    expect(await slackAdapter.publish(ctx({ media: [TWO], checkpoint }))).toMatchObject({
      kind: 'error',
      errorKind: 'validation',
    });
  });

  it('asks for the files:write scope when the token lacks it', async () => {
    server.use(http.post(api('files.getUploadURLExternal'), () => reply('error-missing-scope')));
    expect(await slackAdapter.publish(ctx({ media: [TWO] }))).toMatchObject({
      kind: 'error',
      errorKind: 'auth',
      message: expect.stringMatching(/files:write/),
    });
  });

  it('never sends bytes to a host other than files.slack.com', async () => {
    const seen = uploadFlow();
    server.use(
      http.post(api('files.getUploadURLExternal'), () =>
        HttpResponse.json({ ok: true, upload_url: 'https://evil.test/x', file_id: 'F1' }),
      ),
    );
    expect(await slackAdapter.publish(ctx({ media: [TWO] }))).toMatchObject({ kind: 'error' });
    expect(seen.uploads).toHaveLength(0);
    expect(seen.messages).toHaveLength(0);
  });

  it('retries while an image is still being checked, and fails one that is gone', async () => {
    const seen = uploadFlow();
    const resolve = (retryable: boolean) =>
      slackAdapter.publish(
        ctx({
          media: [[{ id: 'm1' }]],
          resolver: { getFile: async () => ({ ok: false, retryable, message: 'nope' }) },
        }),
      );
    expect(await resolve(true)).toMatchObject({ kind: 'error', errorKind: 'transient' });
    expect(await resolve(false)).toMatchObject({ kind: 'error', errorKind: 'validation' });
    expect(seen.urlRequests).toHaveLength(0);
  });

  it('validates alt text length', () => {
    const codes = (alt: string) =>
      slackAdapter
        .validate(ctx({ media: [[{ id: 'm1', alt }]] }).post, [])
        .filter((i) => i.severity === 'error')
        .map((i) => i.code);
    expect(codes('x'.repeat(2000))).toEqual([]);
    expect(codes('x'.repeat(2001))).toEqual(['alt_text_too_long']);
  });
});
