import type { AccountCredentials } from '@queuesprout/shared';
import {
  ConnectError,
  type ConnectedAccountInput,
  type SecretConnectContext,
  type Target,
} from '../contract';
import { TelegramError } from './errors';
import { telegram } from './http';
import { BOT_TOKEN_PATTERN, normalizeChat } from './limits';

/**
 * Telegram connects a bot the user creates with @BotFather and adds to a channel or group
 * as an admin. The account is the bot, so one token can serve several chats; each chat
 * is a channel in QueueSprout. Bot tokens do not expire until revoked in @BotFather.
 */

interface BotUser {
  id: number;
  is_bot: boolean;
  username?: string;
  first_name: string;
}

interface Chat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

interface ChatMember {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  can_post_messages?: boolean;
  can_send_messages?: boolean;
}

function canPost(chat: Chat, member: ChatMember): boolean {
  if (chat.type === 'channel') {
    return member.status === 'administrator' && member.can_post_messages !== false;
  }
  if (member.status === 'restricted') return member.can_send_messages === true;
  return member.status === 'administrator' || member.status === 'member';
}

function connectFailure(error: unknown, what: string): ConnectError {
  if (error instanceof TelegramError && error.status === 429) {
    return new ConnectError('rate_limited', 'Telegram is rate limiting us. Wait a minute.');
  }
  if (error instanceof TelegramError && error.status < 500) {
    return new ConnectError('rejected', what);
  }
  return new ConnectError('unavailable', 'Could not reach Telegram. Try again in a moment.');
}

/** identifier: the channel or group (@name, t.me link or numeric id); secret: the bot token. */
export async function connectWithSecret(ctx: SecretConnectContext): Promise<ConnectedAccountInput> {
  const token = ctx.secret.trim();
  if (!BOT_TOKEN_PATTERN.test(token)) {
    throw new ConnectError(
      'invalid_credentials',
      'Paste the bot token from @BotFather (it looks like 123456789:AA…).',
    );
  }
  const chatId = normalizeChat(ctx.identifier);
  if (!chatId) {
    throw new ConnectError(
      'rejected',
      'Enter the channel as @name, or its numeric id for a private channel.',
    );
  }

  let bot: BotUser;
  try {
    bot = await telegram<BotUser>(token, 'getMe', { signal: ctx.signal });
  } catch (error) {
    if (error instanceof TelegramError && (error.status === 401 || error.status === 404)) {
      throw new ConnectError('invalid_credentials', 'Telegram did not accept that bot token.');
    }
    throw connectFailure(error, 'Telegram did not accept that bot token.');
  }

  const notAdded = `Add @${bot.username ?? 'your bot'} to the channel as an admin, then try again.`;
  let chat: Chat;
  let member: ChatMember;
  try {
    chat = await telegram<Chat>(token, 'getChat', {
      body: { chat_id: chatId },
      signal: ctx.signal,
    });
    member = await telegram<ChatMember>(token, 'getChatMember', {
      body: { chat_id: chat.id, user_id: bot.id },
      signal: ctx.signal,
    });
  } catch (error) {
    throw connectFailure(error, notAdded);
  }
  if (chat.type === 'private') {
    throw new ConnectError('rejected', 'Connect a channel or a group, not a private chat.');
  }
  if (!canPost(chat, member)) {
    throw new ConnectError(
      'rejected',
      chat.type === 'channel'
        ? `Make @${bot.username ?? 'your bot'} an admin of the channel with permission to post messages.`
        : notAdded,
    );
  }

  const name = bot.username ? `@${bot.username}` : bot.first_name;
  const target: Target = {
    targetType: 'chat',
    // The numeric id: it survives a rename of the channel's @username.
    externalTargetId: String(chat.id),
    name: chat.title?.trim() || (chat.username ? `@${chat.username}` : 'Telegram chat'),
    handle: chat.username ? `@${chat.username}` : null,
  };
  return {
    externalAccountId: String(bot.id),
    displayName: name,
    serviceUrl: null,
    creds: { accessToken: token, refreshToken: null, expiresAt: null, scopes: ['bot'] },
    targets: [target],
  };
}

/** Bot tokens do not expire. */
export async function refreshToken(creds: AccountCredentials): Promise<AccountCredentials> {
  return creds;
}

/** The Bot API cannot list a bot's chats: each one is added with connectWithSecret. */
export async function listTargets(): Promise<Target[]> {
  return [];
}
