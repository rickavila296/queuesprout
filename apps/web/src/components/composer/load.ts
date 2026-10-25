import 'server-only';
import type { ChannelSummary } from '@queuesprout/db';
import type { ComposerChannel } from './composer';

/** Channels as the composer shows them, with the reason a channel cannot take new posts. */
export function toComposerChannels(channels: ChannelSummary[]): ComposerChannel[] {
  return channels.map((c) => ({
    id: c.id,
    provider: c.provider,
    name: c.name,
    handle: c.handle,
    defaultSettings: c.defaultSettings,
    unavailable:
      c.accountStatus !== 'active'
        ? 'Reconnect this account first.'
        : c.channelStatus === 'disabled' || c.channelStatus === 'target_missing'
          ? 'This channel is not available.'
          : null,
  }));
}
