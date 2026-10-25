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
    channels: z
      .array(
        z.object({
          channelId: z.uuid(),
          items: threadSchema.nullable(),
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
  });
export type ComposeInput = z.infer<typeof composeSchema>;

/** The items a channel publishes: its override, or the base thread. */
export function effectiveItems(
  base: readonly string[],
  channel: { items: readonly string[] | null },
): string[] {
  return [...(channel.items ?? base)];
}

/** True when a channel's stored items differ from the base thread, i.e. it was customized. */
export function isOverride(base: readonly string[], items: readonly string[]): boolean {
  return base.length !== items.length || base.some((b, i) => b !== items[i]);
}
