import type { ProviderId } from '@queuesprout/shared';

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
