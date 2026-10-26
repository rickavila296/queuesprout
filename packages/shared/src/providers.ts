import { z } from 'zod';

/** Must match the provider_id enum in Postgres (ADR-002: X/Twitter is out of scope). */
export const PROVIDER_IDS = [
  'bluesky',
  'mastodon',
  'discord',
  'telegram',
  'slack',
  'linkedin',
  'pinterest',
  'youtube',
  'facebook',
  'instagram',
  'threads',
  'tiktok',
] as const;
export const providerIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof providerIdSchema>;

/** Display names, in the order the channel grid shows them. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  discord: 'Discord',
  telegram: 'Telegram',
  slack: 'Slack',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  youtube: 'YouTube',
  facebook: 'Facebook Page',
  instagram: 'Instagram',
  threads: 'Threads',
  tiktok: 'TikTok',
};

export const providerLabel = (id: ProviderId) => PROVIDER_LABELS[id];
