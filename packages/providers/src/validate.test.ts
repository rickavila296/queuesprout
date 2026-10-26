import { describe, expect, it } from 'vitest';
import type { PostItemKind } from '@queuesprout/shared';
import type { ChannelPost } from './contract';
import { getProviderDefinition } from './client';
import { BASE_DEFINITIONS } from './definitions';
import { validateText } from './validate';

const post = (
  provider: keyof typeof BASE_DEFINITIONS,
  items: Array<string | { body: string; kind: PostItemKind; media?: number }>,
  settings: Record<string, unknown> = {},
): ChannelPost => ({
  id: 'p',
  channelId: 'c',
  provider,
  settings,
  items: items.map((i, position) => {
    const o =
      typeof i === 'string' ? { body: i, kind: (position ? 'reply' : 'post') as PostItemKind } : i;
    return {
      id: `i${position}`,
      position,
      kind: o.kind,
      body: o.body,
      mediaIds: Array.from({ length: 'media' in o ? (o.media ?? 0) : 0 }, (_, n) => `m${n}`),
    };
  }),
});

const codes = (p: ChannelPost) => BASE_DEFINITIONS[p.provider].validate(p, []).map((i) => i.code);

describe('base validate()', () => {
  it.each([
    ['bluesky at the limit', post('bluesky', ['x'.repeat(300)]), []],
    ['bluesky over the limit', post('bluesky', ['x'.repeat(301)]), ['text_too_long']],
    // 300 family emoji are 300 graphemes but 2,100 code points: fine on Bluesky.
    ['bluesky counts graphemes', post('bluesky', ['👨‍👩‍👧‍👦'.repeat(300)]), []],
    ['mastodon counts code points', post('mastodon', ['👨‍👩‍👧‍👦'.repeat(72)]), ['text_too_long']],
    ['empty post', post('mastodon', ['   ']), ['empty']],
    ['thread on bluesky', post('bluesky', ['one', 'two', 'three']), []],
    ['thread on discord', post('discord', ['one', 'two']), ['threads_unsupported']],
    [
      'thread too long',
      post(
        'bluesky',
        Array.from({ length: 26 }, () => 'x'),
      ),
      ['thread_too_long'],
    ],
    [
      'first comment on linkedin',
      post('linkedin', ['hi', { body: 'link', kind: 'first_comment' }]),
      [],
    ],
    [
      'first comment on mastodon',
      post('mastodon', ['hi', { body: 'x', kind: 'first_comment' }]),
      ['first_comment_unsupported'],
    ],
    [
      'too many images',
      post('bluesky', [{ body: 'pics', kind: 'post', media: 5 }]),
      ['too_many_media'],
    ],
    ['no main item', post('bluesky', [{ body: 'orphan', kind: 'reply' }]), ['missing_post']],
    ['pinterest without board', post('pinterest', ['pin']), ['invalid_setting']],
    ['pinterest with board', post('pinterest', ['pin'], { board_id: 'b' }), []],
    [
      'pinterest title too long',
      post('pinterest', ['pin'], { board_id: 'b', title: 'x'.repeat(101) }),
      ['invalid_setting'],
    ],
  ])('%s', (_name, p, expected) => {
    expect(codes(p)).toEqual(expected);
  });

  it('refuses images on adapters that do not declare media support', () => {
    const p = post('discord', [{ body: 'pic', kind: 'post', media: 1 }]);
    const limits = BASE_DEFINITIONS.discord.limits;
    const caps = { threads: false, firstComment: false };
    expect(validateText(p, limits, caps).map((i) => i.code)).toEqual(['media_unsupported']);
    expect(validateText(p, limits, { ...caps, media: true }).map((i) => i.code)).toEqual([]);
  });

  it.each(['bluesky', 'mastodon', 'discord', 'telegram', 'slack'] as const)(
    'accepts images on %s',
    (provider) => {
      const p = post(provider, [{ body: 'pic', kind: 'post', media: 1 }]);
      expect(getProviderDefinition(provider).validate(p, [])).toEqual([]);
    },
  );

  it('points item issues at the item', () => {
    const issues = BASE_DEFINITIONS.bluesky.validate(post('bluesky', ['ok', 'x'.repeat(301)]), []);
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'text_too_long',
        itemPosition: 1,
        message: '301 of 300 characters.',
      }),
    ]);
  });
});
