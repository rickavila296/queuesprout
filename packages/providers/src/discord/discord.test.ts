import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { PublishStep } from '@queuesprout/shared';
import { ConnectError } from '../contract';
import { buildPublishContext, loadFixture, useMswServer } from '../testing';
import { discordAdapter } from '.';
import { connectWithSecret, parseWebhookUrl } from './auth';
import { toStepError } from './errors';
import { API_URL, SUPPRESS_EMBEDS } from './limits';
import type { DiscordSettings } from './settings';

const FIXTURES = fileURLToPath(new URL('./__fixtures__', import.meta.url));
const fixture = <T = Record<string, unknown>>(name: string) => loadFixture<T>(FIXTURES, name);

const WEBHOOK_ID = '1300000000000000003';
const TOKEN = 'T'.repeat(34) + '-' + 'k'.repeat(33);
const WEBHOOK_URL = `https://discord.com/api/webhooks/${WEBHOOK_ID}/${TOKEN}`;
const hook = `${API_URL}/webhooks/${WEBHOOK_ID}/${TOKEN}`;
const signal = () => new AbortController().signal;

const server = useMswServer();

const ctx = (input: Parameters<typeof buildPublishContext<DiscordSettings>>[0] = {}) => {
  const c = buildPublishContext<DiscordSettings>({
    provider: 'discord',
    account: { externalId: WEBHOOK_ID, serviceUrl: null },
    ...input,
  });
  return {
    ...c,
    creds: { ...c.creds, accessToken: TOKEN, refreshToken: null },
    target: {
      type: 'server_channel' as const,
      externalId: '1300000000000000001/1300000000000000002',
    },
  };
};

const errorResponse = (name: string, status: number, headers?: Record<string, string>) =>
  HttpResponse.json(fixture(name), { status, headers });

describe('validate()', () => {
  const v = (bodies: string[], settings: DiscordSettings = {}) =>
    discordAdapter
      .validate(ctx({ bodies, settings }).post, [])
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);

  it.each([
    ['a short message', ['Hello Discord'], []],
    ['exactly 2,000 characters', ['x'.repeat(2000)], []],
    ['2,001 characters', ['x'.repeat(2001)], ['text_too_long']],
    ['an empty message', [' '], ['empty']],
    ['a thread', ['one', 'two'], ['threads_unsupported']],
  ])('%s', (_name, bodies, codes) => {
    expect(v(bodies)).toEqual(codes);
  });

  it('checks settings', () => {
    expect(v(['hi'], { suppressEmbeds: true })).toEqual([]);
    expect(v(['hi'], { suppressEmbeds: 'yes' as unknown as boolean })).toEqual(['invalid_setting']);
  });
});

describe('webhook URLs', () => {
  it.each([
    [WEBHOOK_URL, true],
    [`https://discordapp.com/api/webhooks/${WEBHOOK_ID}/${TOKEN}`, true],
    [`https://canary.discord.com/api/v10/webhooks/${WEBHOOK_ID}/${TOKEN}/`, true],
    [`http://discord.com/api/webhooks/${WEBHOOK_ID}/${TOKEN}`, false],
    [`https://evil.example/api/webhooks/${WEBHOOK_ID}/${TOKEN}`, false],
    [`https://discord.com.evil.example/api/webhooks/${WEBHOOK_ID}/${TOKEN}`, false],
    ['https://discord.com/channels/1/2', false],
  ])('%s → %s', (url, ok) => {
    expect(parseWebhookUrl(url) !== null).toBe(ok);
  });
});

describe('connectWithSecret()', () => {
  it('checks the webhook and makes one channel from it', async () => {
    server.use(http.get(hook, () => HttpResponse.json(fixture('webhook'))));
    const account = await connectWithSecret({
      identifier: '#announcements',
      secret: ` ${WEBHOOK_URL} `,
      signal: signal(),
    });
    expect(account).toEqual({
      externalAccountId: WEBHOOK_ID,
      displayName: '#announcements',
      serviceUrl: null,
      creds: { accessToken: TOKEN, refreshToken: null, expiresAt: null, scopes: ['webhook'] },
      targets: [
        {
          targetType: 'server_channel',
          externalTargetId: '1300000000000000001/1300000000000000002',
          name: '#announcements',
          handle: null,
        },
      ],
    });
  });

  it('uses the webhook name when no label is given', async () => {
    server.use(http.get(hook, () => HttpResponse.json(fixture('webhook'))));
    const account = await connectWithSecret({
      identifier: '',
      secret: WEBHOOK_URL,
      signal: signal(),
    });
    expect(account.displayName).toBe('QueueSprout');
  });

  it('refuses anything that is not a Discord webhook URL, before any request', async () => {
    await expect(
      connectWithSecret({ identifier: '', secret: 'https://evil.example/x', signal: signal() }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('turns a deleted webhook into a message safe to show', async () => {
    server.use(http.get(hook, () => errorResponse('error-unknown-webhook', 404)));
    const error = await connectWithSecret({
      identifier: '',
      secret: WEBHOOK_URL,
      signal: signal(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect(error).toMatchObject({ code: 'invalid_credentials' });
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('refuses webhooks that are not incoming webhooks', async () => {
    server.use(
      http.get(hook, () =>
        HttpResponse.json({ ...fixture<Record<string, unknown>>('webhook'), type: 2 }),
      ),
    );
    await expect(
      connectWithSecret({ identifier: '', secret: WEBHOOK_URL, signal: signal() }),
    ).rejects.toMatchObject({ code: 'rejected' });
  });
});

describe('publish()', () => {
  it('executes the webhook and links to the message', async () => {
    let body: unknown;
    let wait: string | null = null;
    server.use(
      http.post(hook, async ({ request }) => {
        body = await request.json();
        wait = new URL(request.url).searchParams.get('wait');
        return HttpResponse.json(fixture('message'));
      }),
    );
    const step = await discordAdapter.publish(
      ctx({ bodies: ['Hello Discord'], settings: { suppressEmbeds: true } }),
    );
    expect(wait).toBe('true');
    expect(body).toEqual({
      content: 'Hello Discord',
      allowed_mentions: { parse: ['users', 'roles'] },
      flags: SUPPRESS_EMBEDS,
    });
    expect(step).toEqual({
      kind: 'done',
      externalId: '1300000000000000010',
      url: 'https://discord.com/channels/1300000000000000001/1300000000000000002/1300000000000000010',
      meta: { id: '1300000000000000010', channelId: '1300000000000000002' },
    });
  });

  it('never pings @everyone or @here', async () => {
    let body: { allowed_mentions?: { parse?: string[] } } = {};
    server.use(
      http.post(hook, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(fixture('message'));
      }),
    );
    await discordAdapter.publish(ctx({ bodies: ['@everyone launch day'] }));
    expect(body.allowed_mentions?.parse).not.toContain('everyone');
  });

  const failWith = async (response: () => Response): Promise<PublishStep> => {
    server.use(http.post(hook, response));
    return discordAdapter.publish(ctx());
  };

  it('maps a deleted webhook and a bad token to auth', async () => {
    expect(await failWith(() => errorResponse('error-unknown-webhook', 404))).toMatchObject({
      errorKind: 'auth',
    });
    expect(await failWith(() => errorResponse('error-invalid-token', 401))).toMatchObject({
      errorKind: 'auth',
    });
  });

  it('maps 400 to validation with the server message', async () => {
    expect(await failWith(() => errorResponse('error-invalid-body', 400))).toMatchObject({
      errorKind: 'validation',
      message: expect.stringContaining('Invalid Form Body'),
    });
  });

  it('maps 429 to rate_limit using retry_after from the body', async () => {
    expect(
      await failWith(() => errorResponse('error-rate-limit', 429, { 'Retry-After': '2' })),
    ).toMatchObject({ errorKind: 'rate_limit', retryAfterMs: 1500 });
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
    server.use(http.post(hook, () => new Promise(() => {})));
    expect(await discordAdapter.publish(ctx({ signal: AbortSignal.timeout(20) }))).toMatchObject({
      kind: 'error',
      errorKind: 'unknown',
    });
  });

  it('retries failures that happen before the request is sent', () => {
    const notSent = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ENOTFOUND' },
    });
    expect(toStepError(notSent)).toMatchObject({ errorKind: 'transient' });
    const dropped = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    expect(toStepError(dropped)).toMatchObject({ errorKind: 'unknown' });
  });

  it('never puts the webhook token in an error', async () => {
    const step = await failWith(() => errorResponse('error-invalid-token', 401));
    expect(JSON.stringify(step)).not.toContain(TOKEN);
  });

  it('fails validation without calling Discord', async () => {
    expect(await discordAdapter.publish(ctx({ bodies: ['x'.repeat(2001)] }))).toMatchObject({
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

  it('sends the images as files with payload_json and alt text descriptions', async () => {
    let payload: unknown;
    const files: { field: string; name: string; type: string; size: number }[] = [];
    server.use(
      http.post(hook, async ({ request }) => {
        const form = await request.formData();
        payload = JSON.parse(String(form.get('payload_json')));
        for (const [field, value] of form.entries()) {
          if (value instanceof File) {
            files.push({ field, name: value.name, type: value.type, size: value.size });
          }
        }
        return HttpResponse.json(fixture('message'));
      }),
    );
    const step = await discordAdapter.publish(ctx({ bodies: ['Look'], media: [TWO] }));
    expect(step).toMatchObject({ kind: 'done', externalId: '1300000000000000010' });
    expect(payload).toEqual({
      content: 'Look',
      allowed_mentions: { parse: ['users', 'roles'] },
      attachments: [
        { id: 0, filename: 'image-1.png', description: 'A green square' },
        { id: 1, filename: 'image-2.png' },
      ],
    });
    expect(files).toEqual([
      { field: 'files[0]', name: 'image-1.png', type: 'image/png', size: 11 },
      { field: 'files[1]', name: 'image-2.png', type: 'image/png', size: 11 },
    ]);
  });

  it('splits the message upload limit between the images', async () => {
    server.use(http.post(hook, () => HttpResponse.json(fixture('message'))));
    const specs: { maxBytes: number }[] = [];
    await discordAdapter.publish(
      ctx({
        media: [Array.from({ length: 4 }, (_, i) => ({ id: `m${i}` }))],
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
    expect(specs.map((s) => s.maxBytes)).toEqual([2_375_000, 2_375_000, 2_375_000, 2_375_000]);
  });

  it('retries while an image is still being checked, and fails one that is gone', async () => {
    let calls = 0;
    server.use(
      http.post(hook, () => {
        calls++;
        return HttpResponse.json(fixture('message'));
      }),
    );
    const resolve = (retryable: boolean) =>
      discordAdapter.publish(
        ctx({
          media: [[{ id: 'm1' }]],
          resolver: { getFile: async () => ({ ok: false, retryable, message: 'nope' }) },
        }),
      );
    expect(await resolve(true)).toMatchObject({ kind: 'error', errorKind: 'transient' });
    expect(await resolve(false)).toMatchObject({ kind: 'error', errorKind: 'validation' });
    expect(calls).toBe(0);
  });

  it('maps a refused upload like any other error', async () => {
    server.use(http.post(hook, () => errorResponse('error-invalid-body', 400)));
    expect(await discordAdapter.publish(ctx({ media: [TWO] }))).toMatchObject({
      kind: 'error',
      errorKind: 'validation',
    });
  });

  it('validates image count and alt text length', () => {
    const codes = (media: { id: string; alt?: string }[]) =>
      discordAdapter
        .validate(ctx({ media: [media] }).post, [])
        .filter((i) => i.severity === 'error')
        .map((i) => i.code);
    expect(codes(TWO)).toEqual([]);
    expect(codes(Array.from({ length: 11 }, (_, i) => ({ id: `m${i}` })))).toEqual([
      'too_many_media',
    ]);
    expect(codes([{ id: 'm1', alt: 'x'.repeat(1025) }])).toEqual(['alt_text_too_long']);
  });
});
