import type { ProviderId } from './providers';

/**
 * How a platform counts characters. Bluesky counts graphemes (an emoji family is 1),
 * most others count Unicode code points.
 */
export type CharCountMode = 'graphemes' | 'code_points';

export interface PlatformLimits {
  /** Max characters in a post body (item 0 and each reply). */
  maxChars: number;
  countMode: CharCountMode;
  /** Max media attachments on one item. 0 means text only. */
  maxMedia: number;
  /** Max items in a thread, including item 0. 1 means no threads. */
  maxThreadItems: number;
}

/**
 * Starting limits per platform. They are approximate (mid-2026): each adapter
 * verifies its own against the official docs and overrides them, and Mastodon
 * replaces maxChars with the instance's value at connect time.
 */
export const PLATFORM_LIMITS: Record<ProviderId, PlatformLimits> = {
  bluesky: { maxChars: 300, countMode: 'graphemes', maxMedia: 4, maxThreadItems: 25 },
  mastodon: { maxChars: 500, countMode: 'code_points', maxMedia: 4, maxThreadItems: 25 },
  discord: { maxChars: 2000, countMode: 'code_points', maxMedia: 10, maxThreadItems: 1 },
  telegram: { maxChars: 4096, countMode: 'code_points', maxMedia: 10, maxThreadItems: 1 },
  slack: { maxChars: 40000, countMode: 'code_points', maxMedia: 10, maxThreadItems: 25 },
  linkedin: { maxChars: 3000, countMode: 'code_points', maxMedia: 9, maxThreadItems: 2 },
  pinterest: { maxChars: 500, countMode: 'code_points', maxMedia: 1, maxThreadItems: 1 },
  youtube: { maxChars: 5000, countMode: 'code_points', maxMedia: 1, maxThreadItems: 1 },
  facebook: { maxChars: 63206, countMode: 'code_points', maxMedia: 10, maxThreadItems: 2 },
  instagram: { maxChars: 2200, countMode: 'code_points', maxMedia: 10, maxThreadItems: 2 },
  threads: { maxChars: 500, countMode: 'code_points', maxMedia: 20, maxThreadItems: 25 },
  tiktok: { maxChars: 2200, countMode: 'code_points', maxMedia: 35, maxThreadItems: 1 },
};

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Counts text the way the platform does. */
export function countChars(text: string, mode: CharCountMode): number {
  if (mode === 'code_points') return [...text].length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}
