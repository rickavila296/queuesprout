import { z } from 'zod';
import { WALL_TIME_PATTERN } from './time';
import { workspaceSlugSchema } from './workspace';

/** Longest body any platform takes (Facebook, 63,206), with headroom. Bounds the payload. */
export const MAX_ITEM_CHARS = 70_000;
/** Longest thread any platform takes. */
export const MAX_THREAD_ITEMS = 25;
export const MAX_CHANNELS_PER_POST = 50;

const threadSchema = z
  .array(z.string().max(MAX_ITEM_CHARS))
  .min(1)
  .max(MAX_THREAD_ITEMS, `A thread can have at most ${MAX_THREAD_ITEMS} posts.`);

/** Most attachments any platform takes on one item (Threads carousels: 20). */
export const MAX_MEDIA_PER_ITEM = 20;
export const MAX_ALT_TEXT_CHARS = 2000;

export const itemMediaSchema = z.object({
  mediaId: z.uuid(),
  altText: z.string().trim().max(MAX_ALT_TEXT_CHARS, 'Alt text is too long.').default(''),
});
export type ItemMedia = z.infer<typeof itemMediaSchema>;

/**
 * Attachments per thread item, by position: media[i] belongs to item i, and a missing
 * entry means none. Kept beside the text arrays so text-only callers stay unchanged.
 */
const threadMediaSchema = z
  .array(
    z
      .array(itemMediaSchema)
      .max(MAX_MEDIA_PER_ITEM, `At most ${MAX_MEDIA_PER_ITEM} attachments per post.`)
      .refine(
        (list) => new Set(list.map((m) => m.mediaId)).size === list.length,
        'Each file can be attached once per post.',
      ),
  )
  .max(MAX_THREAD_ITEMS);

export const COMPOSE_MODES = ['draft', 'schedule', 'now'] as const;
export type ComposeMode = (typeof COMPOSE_MODES)[number];

/**
 * What the composer submits. Each channel either follows the base thread (items null)
 * or overrides it. version is the post's version when the composer loaded it, so a
 * save cannot overwrite an edit made elsewhere in the meantime.
 */
export const composeSchema = z
  .object({
    workspaceSlug: workspaceSlugSchema,
    groupId: z.uuid().optional(),
    baseItems: threadSchema,
    baseMedia: threadMediaSchema.default([]),
    channels: z
      .array(
        z.object({
          channelId: z.uuid(),
          items: threadSchema.nullable(),
          /** The override's attachments; ignored while items is null. */
          media: threadMediaSchema.default([]),
          version: z.number().int().positive().optional(),
        }),
      )
      .min(1, 'Pick at least one channel.')
      .max(MAX_CHANNELS_PER_POST)
      .refine(
        (list) => new Set(list.map((c) => c.channelId)).size === list.length,
        'Each channel can be picked once.',
      ),
    mode: z.enum(COMPOSE_MODES),
    /** Workspace wall-clock time, required when mode is schedule. */
    scheduledAt: z.string().regex(WALL_TIME_PATTERN).optional(),
  })
  .refine((v) => v.mode !== 'schedule' || v.scheduledAt !== undefined, {
    message: 'Pick a date and time.',
    path: ['scheduledAt'],
  })
  .refine(
    (v) =>
      v.baseMedia.length <= v.baseItems.length &&
      v.channels.every((c) => c.items === null || c.media.length <= c.items.length),
    { message: 'Attachments must belong to a post in the thread.', path: ['baseMedia'] },
  );
export type ComposeInput = z.infer<typeof composeSchema>;

/** The items a channel publishes: its override, or the base thread. */
export function effectiveItems(
  base: readonly string[],
  channel: { items: readonly string[] | null },
): string[] {
  return [...(channel.items ?? base)];
}

/** The attachments a channel publishes, one list per item: its override's, or the base's. */
export function effectiveMedia(
  baseItems: readonly string[],
  baseMedia: readonly (readonly ItemMedia[])[],
  channel: { items: readonly string[] | null; media: readonly (readonly ItemMedia[])[] },
): ItemMedia[][] {
  const [items, media] = channel.items ? [channel.items, channel.media] : [baseItems, baseMedia];
  return items.map((_, i) => (media[i] ?? []).map((m) => ({ ...m })));
}

const sameMedia = (a: readonly ItemMedia[] = [], b: readonly ItemMedia[] = []) =>
  a.length === b.length &&
  a.every((m, i) => m.mediaId === b[i]?.mediaId && m.altText === b[i]?.altText);

/** True when a channel's stored thread differs from the base, i.e. it was customized. */
export function isOverride(
  base: readonly string[],
  items: readonly string[],
  baseMedia: readonly (readonly ItemMedia[])[] = [],
  media: readonly (readonly ItemMedia[])[] = [],
): boolean {
  return (
    base.length !== items.length ||
    base.some((b, i) => b !== items[i] || !sameMedia(baseMedia[i], media[i]))
  );
}
