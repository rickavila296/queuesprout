import type { ProviderId, PublishCheckpoint } from '@queuesprout/shared';
import type {
  AccountRef,
  ChannelPost,
  ItemRef,
  MediaResolver,
  PostItem,
  PublishContext,
} from '../contract';

export const TEST_NOW = new Date('2026-10-25T12:00:00.000Z');

export interface ContextInput<TSettings> {
  provider?: ProviderId;
  /** Bodies of item 0 and its replies. */
  bodies?: string[];
  settings?: TSettings;
  /** Which item this step works on. Default 0. */
  position?: number;
  checkpoint?: PublishCheckpoint | null;
  parent?: ItemRef | null;
  root?: ItemRef | null;
  signal?: AbortSignal;
  now?: () => Date;
  account?: AccountRef;
  /** Attachments by item position: ids and alt texts. */
  media?: { id: string; alt?: string }[][];
  /** Replaces the default resolver, which serves a 4x3 PNG for any id. */
  resolver?: Partial<MediaResolver>;
}

/** The smallest valid PNG header bytes the default resolver hands out. */
export const TEST_IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Builds a PublishContext with fake credentials and, unless given, no media. */
export function buildPublishContext<TSettings = Record<string, unknown>>(
  input: ContextInput<TSettings> = {},
): PublishContext<TSettings> {
  const provider = input.provider ?? 'bluesky';
  const items: PostItem[] = (input.bodies ?? ['Hello from QueueSprout']).map((body, position) => ({
    id: `item-${position}`,
    position,
    kind: position === 0 ? 'post' : 'reply',
    body,
    mediaIds: (input.media?.[position] ?? []).map((m) => m.id),
    altTexts: (input.media?.[position] ?? []).map((m) => m.alt ?? ''),
    createdAt: new Date(TEST_NOW.getTime() - 86_400_000 + position * 1000),
  }));
  const post: ChannelPost<TSettings> = {
    id: 'post-1',
    channelId: 'channel-1',
    provider,
    settings: input.settings ?? ({} as TSettings),
    items,
  };
  const item = items[input.position ?? 0];
  if (!item) throw new Error(`No item at position ${input.position}`);
  return {
    post,
    item,
    parent: input.parent ?? null,
    root: input.root ?? null,
    checkpoint: input.checkpoint ?? null,
    creds: {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: new Date(TEST_NOW.getTime() + 3_600_000),
      scopes: [],
    },
    account: input.account ?? { externalId: 'did:plc:test', serviceUrl: 'https://pds.test' },
    channelCreds: null,
    target: { type: 'profile', externalId: 'did:plc:test' },
    media: {
      getUrl: async (id) => `https://media.test/${id}`,
      getInfo: async (id) => ({ id, mime: 'image/png', bytes: TEST_IMAGE.byteLength }),
      getFile: async () => ({
        ok: true,
        file: { bytes: TEST_IMAGE, mime: 'image/png', width: 4, height: 3 },
      }),
      ...input.resolver,
    },
    signal: input.signal ?? new AbortController().signal,
    now: input.now ?? (() => TEST_NOW),
  };
}
