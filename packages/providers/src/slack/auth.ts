import type { AccountCredentials } from '@queuesprout/shared';
import {
  ConnectError,
  type ConnectedAccountInput,
  type SecretConnectContext,
  type Target,
} from '../contract';
import { isPublicHttpsUrl } from '../net';
import { SlackError } from './errors';
import { slack } from './http';
import { BOT_TOKEN_PATTERN, parseChannel } from './limits';

/**
 * Slack connects an app the user creates at api.slack.com/apps and installs to their
 * workspace, which gives a bot token (xoxb-…). The account is the bot in one Slack
 * workspace, so one token can serve several channels; each is a channel in QueueSprout.
 * An "Add to Slack" OAuth button can replace the pasted token once the app is public.
 */

interface AuthTest {
  url: string;
  team: string;
  team_id: string;
  user_id: string;
}

interface Conversation {
  id: string;
  name: string;
  is_member?: boolean;
  is_archived?: boolean;
  is_private?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
}

/** conversations.list pages read when looking a channel up by name. */
const MAX_PAGES = 5;

function connectFailure(error: unknown, what: string): ConnectError {
  if (error instanceof SlackError && (error.status === 429 || error.code === 'ratelimited')) {
    return new ConnectError('rate_limited', 'Slack is rate limiting us. Wait a minute.');
  }
  if (error instanceof SlackError && error.code === 'missing_scope') {
    return new ConnectError(
      'rejected',
      'The Slack app needs the chat:write, channels:read, groups:read and files:write scopes. Add them, reinstall the app and copy the new token.',
    );
  }
  if (error instanceof SlackError && error.status < 500) {
    return new ConnectError('rejected', what);
  }
  return new ConnectError('unavailable', 'Could not reach Slack. Try again in a moment.');
}

async function findChannel(
  token: string,
  wanted: { id: string } | { name: string },
  signal: AbortSignal,
): Promise<Conversation | null> {
  if ('id' in wanted) {
    const { channel } = await slack<{ channel: Conversation }>(token, 'conversations.info', {
      body: { channel: wanted.id },
      signal,
    });
    return channel;
  }
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await slack<{
      channels: Conversation[];
      response_metadata?: { next_cursor?: string };
    }>(token, 'conversations.list', {
      body: {
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 1000,
        ...(cursor && { cursor }),
      },
      signal,
    });
    const match = res.channels.find((c) => c.name === wanted.name);
    if (match) return match;
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return null;
}

/** identifier: the channel (#name or id); secret: the bot token. */
export async function connectWithSecret(ctx: SecretConnectContext): Promise<ConnectedAccountInput> {
  const token = ctx.secret.trim();
  if (!BOT_TOKEN_PATTERN.test(token)) {
    throw new ConnectError(
      'invalid_credentials',
      'Paste the Bot User OAuth Token from your Slack app (it starts with xoxb-).',
    );
  }
  const wanted = parseChannel(ctx.identifier);
  if (!wanted) {
    throw new ConnectError('rejected', 'Enter the channel as #name, or its id like C0123ABCD.');
  }

  let me: AuthTest;
  try {
    me = await slack<AuthTest>(token, 'auth.test', { signal: ctx.signal });
  } catch (error) {
    if (error instanceof SlackError && error.status < 500 && error.status !== 429) {
      throw new ConnectError('invalid_credentials', 'Slack did not accept that bot token.');
    }
    throw connectFailure(error, 'Slack did not accept that bot token.');
  }

  let channel: Conversation | null;
  try {
    channel = await findChannel(token, wanted, ctx.signal);
  } catch (error) {
    throw connectFailure(
      error,
      'Slack could not find that channel. For a private channel, invite the app first.',
    );
  }
  if (!channel) {
    throw new ConnectError(
      'rejected',
      'Slack could not find that channel. For a private channel, invite the app first.',
    );
  }
  if (channel.is_im || channel.is_mpim) {
    throw new ConnectError('rejected', 'Connect a channel, not a direct message.');
  }
  if (channel.is_archived) {
    throw new ConnectError('rejected', 'That channel is archived.');
  }
  if (!channel.is_member) {
    throw new ConnectError(
      'rejected',
      `Invite the app to #${channel.name} first: type /invite and pick it, then try again.`,
    );
  }

  const target: Target = {
    targetType: 'server_channel',
    externalTargetId: channel.id,
    name: `#${channel.name}`,
    handle: null,
  };
  return {
    externalAccountId: `${me.team_id}/${me.user_id}`,
    displayName: me.team,
    // The workspace's own address, for message links.
    serviceUrl: isPublicHttpsUrl(me.url) ? me.url : null,
    creds: { accessToken: token, refreshToken: null, expiresAt: null, scopes: ['chat:write'] },
    targets: [target],
  };
}

/** Bot tokens do not expire unless token rotation is turned on, which this flow does not use. */
export async function refreshToken(creds: AccountCredentials): Promise<AccountCredentials> {
  return creds;
}

/** Channels are added one at a time with connectWithSecret, so nothing else to list. */
export async function listTargets(): Promise<Target[]> {
  return [];
}
