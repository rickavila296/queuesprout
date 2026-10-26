import type { AccountCredentials } from '@queuesprout/shared';
import {
  ConnectError,
  type AccountRef,
  type ConnectedAccountInput,
  type SecretConnectContext,
  type Target,
} from '../contract';
import { DiscordError } from './errors';
import { discord } from './http';
import { WEBHOOK_URL_PATTERN } from './limits';

/**
 * Discord connects one server channel through an incoming webhook the user creates in
 * Channel settings > Integrations > Webhooks. The webhook's token is the only secret:
 * it is stored encrypted like an access token and never expires. A bot with an OAuth
 * invite can replace this later without changing the publish step.
 */

interface WebhookResponse {
  id: string;
  /** 1 = incoming webhook. */
  type: number;
  guild_id?: string | null;
  channel_id: string;
  name?: string | null;
}

export function parseWebhookUrl(url: string): { id: string; token: string } | null {
  const match = WEBHOOK_URL_PATTERN.exec(url.trim());
  return match?.[1] && match[2] ? { id: match[1], token: match[2] } : null;
}

/** guild/channel: what publish needs to build a message link. */
const targetId = (webhook: WebhookResponse) => `${webhook.guild_id ?? '@me'}/${webhook.channel_id}`;

function toTarget(webhook: WebhookResponse, label?: string): Target {
  return {
    targetType: 'server_channel',
    externalTargetId: targetId(webhook),
    name: label?.trim() || webhook.name?.trim() || 'Discord channel',
    handle: null,
  };
}

async function getWebhook(id: string, token: string, signal: AbortSignal) {
  return discord<WebhookResponse>('GET', `/webhooks/${id}/${token}`, { signal });
}

/** identifier: an optional label for the channel; secret: the webhook URL. */
export async function connectWithSecret(ctx: SecretConnectContext): Promise<ConnectedAccountInput> {
  const parsed = parseWebhookUrl(ctx.secret);
  if (!parsed) {
    throw new ConnectError(
      'invalid_credentials',
      'Paste the full webhook URL from Discord (it starts with https://discord.com/api/webhooks/).',
    );
  }
  let webhook: WebhookResponse;
  try {
    webhook = await getWebhook(parsed.id, parsed.token, ctx.signal);
  } catch (error) {
    if (error instanceof DiscordError && error.status === 429) {
      throw new ConnectError('rate_limited', 'Discord is rate limiting us. Wait a minute.');
    }
    if (error instanceof DiscordError && error.status < 500) {
      throw new ConnectError(
        'invalid_credentials',
        'Discord did not recognise that webhook. Copy it again from the channel settings.',
      );
    }
    throw new ConnectError('unavailable', 'Could not reach Discord. Try again in a moment.');
  }
  if (webhook.type !== 1) {
    throw new ConnectError('rejected', 'Use an incoming webhook from the channel settings.');
  }
  const target = toTarget(webhook, ctx.identifier);
  return {
    externalAccountId: webhook.id,
    displayName: target.name,
    serviceUrl: null,
    creds: { accessToken: parsed.token, refreshToken: null, expiresAt: null, scopes: ['webhook'] },
    targets: [target],
  };
}

/** Webhook tokens do not expire. */
export async function refreshToken(creds: AccountCredentials): Promise<AccountCredentials> {
  return creds;
}

export async function listTargets(
  creds: AccountCredentials,
  signal: AbortSignal,
  account: AccountRef,
): Promise<Target[]> {
  return [toTarget(await getWebhook(account.externalId, creds.accessToken, signal))];
}
