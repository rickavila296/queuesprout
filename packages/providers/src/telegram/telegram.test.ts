import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { PublishStep } from '@queuesprout/shared';
import { ConnectError } from '../contract';
import { buildPublishContext, loadFixture, useMswServer } from '../testing';
import { telegramAdapter } from '.';
import { connectWithSecret } from './auth';
import { toStepError } from './errors';
import { API_URL, normalizeChat } from './limits';
import { messageUrl } from './publish';
import type { TelegramSettings } from './settings';

const FIXTURES = fileURLToPath(new URL('./__fixtures__', import.meta.url));
const fixture = <T = Record<string, unknown>>(name: string) => loadFixture<T>(FIXTURES, name);

const TOKEN = '7000000001:' + 'A'.repeat(20) + '-' + 'b'.repeat(14);
const api = (method: string) => `${API_URL}/bot${TOKEN}/${method}`;
const signal = () => new AbortController().signal;
const CHAT_ID = '-1001000000002';

const server = useMswServer();

const ctx = (input: Parameters<typeof buildPublishContext<TelegramSettings>>[0] = {}) => {
  const c = buildPublishContext<TelegramSettings>({
    provider: 'telegram',
    account: { externalId: '7000000001', serviceUrl: null },
    ...input,
  });
  return {
    ...c,
    creds: { ...c.creds, accessToken: TOKEN, refreshToken: null },
    target: { type: 'chat' as const, externalId: CHAT_ID },
  };
};

const reply = (name: string, status = 200) => HttpResponse.json(fixture(name), { status });

/** getMe, getChat and getChatMember all answering for a channel where the bot is an admin. */
const connectable = (overrides: { chat?: object; member?: object } = {}) =>
  server.use(
    http.post(api('getMe'), () => reply('get-me')),
    http.post(api('getChat'), () =>
      HttpResponse.json({
        ok: true,
        result: { ...fixture<{ result: object }>('get-chat-channel').result, ...overrides.chat },
      }),
    ),
    http.post(api('getChatMember'), () =>
      HttpResponse.json({
        ok: true,
        result: {
          ...fixture<{ result: object }>('get-chat-member-admin').result,
          ...overrides.member,
        },
      }),
    ),
  );

describe('validate()', () => {
  const v = (bodies: string[], settings: TelegramSettings = {}) =>
    telegramAdapter
      .validate(ctx({ bodies, settings }).post, [])
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);

  it.each([
    ['a short message', ['Hello Telegram'], []],
    ['exactly 4,096 characters', ['x'.repeat(4096)], []],
    ['4,097 characters', ['x'.repeat(4097)], ['text_too_long']],
    ['an empty message', [' '], ['empty']],
    ['a thread', ['one', 'two'], ['threads_unsupported']],
  ])('%s', (_name, bodies, codes) => {
    expect(v(bodies)).toEqual(codes);
  });

  it('checks settings', () => {
    expect(v(['hi'], { disableLinkPreview: true, silent: true })).toEqual([]);
    expect(v(['hi'], { silent: 'yes' as unknown as boolean })).toEqual(['invalid_setting']);
  });
});

describe('chat names', () => {
  it.each([
    ['@acmecoffee_news', '@acmecoffee_news'],
    ['acmecoffee_news', '@acmecoffee_news'],
    ['https://t.me/acmecoffee_news', '@acmecoffee_news'],
    ['t.me/acmecoffee_news/', '@acmecoffee_news'],
    [' -1001000000002 ', '-1001000000002'],
    ['https://evil.example/acme', null],
    ['@ab', null],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(normalizeChat(input)).toBe(expected);
  });
});

describe('connectWithSecret()', () => {
  it('checks the bot, the chat and the bot’s rights, then makes one channel', async () => {
    connectable();
    let chatBody: unknown;
    let memberBody: unknown;
    server.use(
      http.post(api('getChat'), async ({ request }) => {
        chatBody = await request.json();
        return reply('get-chat-channel');
      }),
      http.post(api('getChatMember'), async ({ request }) => {
        memberBody = await request.json();
        return reply('get-chat-member-admin');
      }),
    );
    const account = await connectWithSecret({
      identifier: 'https://t.me/acmecoffee_news',
      secret: ` ${TOKEN} `,
      signal: signal(),
    });
    expect(chatBody).toEqual({ chat_id: '@acmecoffee_news' });
    expect(memberBody).toEqual({ chat_id: -1001000000002, user_id: 7000000001 });
    expect(account).toEqual({
      externalAccountId: '7000000001',
      displayName: '@queuesprout_test_bot',
      serviceUrl: null,
      creds: { accessToken: TOKEN, refreshToken: null, expiresAt: null, scopes: ['bot'] },
      targets: [
        {
          targetType: 'chat',
          externalTargetId: CHAT_ID,
          name: 'Acme Coffee News',
          handle: '@acmecoffee_news',
        },
      ],
    });
  });

  it('accepts a group where the bot is a plain member', async () => {
    connectable({
      chat: { id: -1001000000005, type: 'supergroup', title: 'Team', username: undefined },
      member: { status: 'member', can_post_messages: undefined },
    });
    const account = await connectWithSecret({
      identifier: '-1001000000005',
      secret: TOKEN,
      signal: signal(),
    });
    expect(account.targets[0]).toMatchObject({ externalTargetId: '-1001000000005', handle: null });
  });

  it('refuses a malformed token or chat before any request', async () => {
    await expect(
      connectWithSecret({ identifier: '@acmecoffee_news', secret: 'nope', signal: signal() }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(
      connectWithSecret({ identifier: 'https://evil.example/x', secret: TOKEN, signal: signal() }),
    ).rejects.toMatchObject({ code: 'rejected' });
  });

  it('turns a revoked token into a message safe to show', async () => {
    server.use(http.post(api('getMe'), () => reply('error-unauthorized', 401)));
    const error = await connectWithSecret({
      identifier: '@acmecoffee_news',
      secret: TOKEN,
      signal: signal(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect(error).toMatchObject({ code: 'invalid_credentials' });
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('asks to add the bot when it cannot see the chat', async () => {
    connectable();
    server.use(http.post(api('getChat'), () => reply('error-chat-not-found', 400)));
    await expect(
      connectWithSecret({ identifier: '@acmecoffee_news', secret: TOKEN, signal: signal() }),
    ).rejects.toMatchObject({
      code: 'rejected',
      message: expect.stringContaining('Add @queuesprout_test_bot'),
    });
  });

  it.each([
    ['a channel member that is not an admin', { status: 'member' }],
    ['an admin without the post right', { status: 'administrator', can_post_messages: false }],
    ['a bot that left', { status: 'left' }],
  ])('refuses %s', async (_name, member) => {
    connectable({ member });
    await expect(
      connectWithSecret({ identifier: '@acmecoffee_news', secret: TOKEN, signal: signal() }),
    ).rejects.toMatchObject({ code: 'rejected' });
  });

  it('refuses private chats', async () => {
    connectable({ chat: { type: 'private' } });
    await expect(
      connectWithSecret({ identifier: '123456789', secret: TOKEN, signal: signal() }),
    ).rejects.toMatchObject({ code: 'rejected' });
  });

  it('maps 429 and outages', async () => {
    server.use(http.post(api('getMe'), () => reply('error-rate-limit', 429)));
    await expect(
      connectWithSecret({ identifier: '@acmecoffee_news', secret: TOKEN, signal: signal() }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    server.use(http.post(api('getMe'), () => new HttpResponse('Bad Gateway', { status: 502 })));
    await expect(
      connectWithSecret({ identifier: '@acmecoffee_news', secret: TOKEN, signal: signal() }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('publish()', () => {
  it('sends plain text and links to the message', async () => {
    let body: unknown;
    server.use(
      http.post(api('sendMessage'), async ({ request }) => {
        body = await request.json();
        return reply('send-message');
      }),
    );
    const step = await telegramAdapter.publish(
      ctx({ bodies: ['Hello Telegram'], settings: { disableLinkPreview: true, silent: true } }),
    );
    expect(body).toEqual({
      chat_id: CHAT_ID,
      text: 'Hello Telegram',
      link_preview_options: { is_disabled: true },
      disable_notification: true,
    });
    expect(step).toEqual({
      kind: 'done',
      externalId: '42',
      url: 'https://t.me/acmecoffee_news/42',
      meta: { messageId: 42, chatId: -1001000000002 },
    });
  });

  it('sends no options when no settings are set, and never a parse_mode', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(api('sendMessage'), async ({ request }) => {
        body = (await request.json()) as typeof body;
        return reply('send-message');
      }),
    );
    await telegramAdapter.publish(ctx({ bodies: ['*not bold*'] }));
    expect(body).toEqual({ chat_id: CHAT_ID, text: '*not bold*' });
  });

  it.each([
    [{ id: -1001000000002, username: 'acme' }, 'https://t.me/acme/7'],
    [{ id: -1001000000002 }, 'https://t.me/c/1000000002/7'],
    [{ id: -4000000001 }, ''],
  ])('links %o as %s', (chat, url) => {
    expect(messageUrl({ message_id: 7, chat })).toBe(url);
  });

  const failWith = async (response: () => Response): Promise<PublishStep> => {
    server.use(http.post(api('sendMessage'), response));
    return telegramAdapter.publish(ctx());
  };

  it('maps a revoked token, a kicked bot, a lost chat and a migrated group to auth', async () => {
    for (const [name, status] of [
      ['error-unauthorized', 401],
      ['error-kicked', 403],
      ['error-chat-not-found', 400],
      ['error-migrated', 400],
    ] as const) {
      expect(await failWith(() => reply(name, status))).toMatchObject({ errorKind: 'auth' });
    }
  });

  it('maps other 400s to validation with the server message', async () => {
    expect(await failWith(() => reply('error-too-long', 400))).toMatchObject({
      errorKind: 'validation',
      message: expect.stringContaining('message is too long'),
    });
  });

  it('maps 429 to rate_limit using retry_after from the body', async () => {
    expect(await failWith(() => reply('error-rate-limit', 429))).toMatchObject({
      errorKind: 'rate_limit',
      retryAfterMs: 7000,
    });
  });

  it.each([500, 502, 503])('maps %i to transient', async (status) => {
    expect(await failWith(() => new HttpResponse('error', { status }))).toMatchObject({
      errorKind: 'transient',
    });
  });

  it('reports a gateway timeout as unknown: the message may exist', async () => {
    expect(await failWith(() => new HttpResponse('timeout', { status: 504 }))).toMatchObject({
      errorKind: 'unknown',
    });
  });

  it('reports a timeout as unknown, so the worker never posts twice', async () => {
    server.use(http.post(api('sendMessage'), () => new Promise(() => {})));
    expect(await telegramAdapter.publish(ctx({ signal: AbortSignal.timeout(20) }))).toMatchObject({
      kind: 'error',
      errorKind: 'unknown',
    });
  });

  it('retries failures that happen before the request is sent', () => {
    const notSent = Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } });
    expect(toStepError(notSent)).toMatchObject({ errorKind: 'transient' });
    const dropped = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    expect(toStepError(dropped)).toMatchObject({ errorKind: 'unknown' });
  });

  it('never puts the bot token in an error', async () => {
    const step = await failWith(() => reply('error-unauthorized', 401));
    expect(JSON.stringify(step)).not.toContain(TOKEN);
    expect(JSON.stringify(step)).not.toContain(TOKEN.split(':')[1]);
  });

  it('fails validation without calling Telegram', async () => {
    expect(await telegramAdapter.publish(ctx({ bodies: ['x'.repeat(4097)] }))).toMatchObject({
      kind: 'error',
      errorKind: 'validation',
    });
  });
});
