import { z } from 'zod';

/**
 * Publishing types shared by the worker, core and every provider adapter
 * (ADR-009, ADR-016). Anything stored in jsonb or carried in a job payload has a
 * Zod schema here so it is checked on the way back in.
 */

/** Must match the post_status enum in Postgres. */
export const POST_STATUSES = [
  'draft',
  'pending_approval',
  'scheduled',
  'queued',
  'publishing',
  'processing',
  'published',
  'failed',
  'cancelled',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Statuses only the worker may set; the database rejects them from apps/web. */
export const WORKER_ONLY_POST_STATUSES = [
  'queued',
  'publishing',
  'processing',
  'published',
  'failed',
] as const satisfies readonly PostStatus[];

/** Statuses in which users may edit a post. Once queued, it is locked until it finishes. */
export const EDITABLE_POST_STATUSES = [
  'draft',
  'pending_approval',
  'scheduled',
  'failed',
] as const satisfies readonly PostStatus[];

/** Must match the item_status enum in Postgres. */
export const ITEM_STATUSES = ['pending', 'published', 'failed'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const POST_ITEM_KINDS = ['post', 'reply', 'first_comment'] as const;
export type PostItemKind = (typeof POST_ITEM_KINDS)[number];

/** Must match the attempt_outcome enum in Postgres. */
export const ATTEMPT_OUTCOMES = [
  'success',
  'pending',
  'retryable_error',
  'fatal_error',
  'unknown',
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/** Must match the account_status enum in Postgres. */
export const ACCOUNT_STATUSES = ['active', 'needs_reauth', 'revoked'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Must match the channel_status enum in Postgres. */
export const CHANNEL_STATUSES = ['active', 'rate_limited', 'disabled', 'target_missing'] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const AUTH_TYPES = [
  'oauth2',
  'oauth2_pkce',
  'atproto_oauth',
  'app_password',
  'bot_token',
] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const TARGET_TYPES = [
  'profile',
  'page',
  'org',
  'server_channel',
  'chat',
  'account',
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/**
 * How a failed step is classified. auth stops and asks for reauth; rate_limit and
 * transient retry with backoff; validation and expired fail at once; unknown means
 * the request may have gone out, so the post fails with "verify on platform".
 */
export const PUBLISH_ERROR_KINDS = [
  'auth',
  'rate_limit',
  'validation',
  'transient',
  'expired',
  'unknown',
] as const;
export const publishErrorKindSchema = z.enum(PUBLISH_ERROR_KINDS);
export type PublishErrorKind = z.infer<typeof publishErrorKindSchema>;

/** What earlier steps already did for the current item. Stored in posts.publish_checkpoint. */
export const publishCheckpointSchema = z.object({
  /** Adapter-defined, e.g. 'container_created' | 'uploading' | 'publish_requested'. */
  stage: z.string().min(1),
  /** Instagram/Threads creation_id, TikTok publish_id. */
  containerId: z.string().optional(),
  childContainerIds: z.array(z.string()).optional(),
  /** YouTube resumable session URI. */
  uploadSessionUrl: z.string().optional(),
  uploadedBytes: z.number().int().nonnegative().optional(),
  /** ISO time the first step for this item started, for the processing deadline. */
  startedAt: z.iso.datetime(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type PublishCheckpoint = z.infer<typeof publishCheckpointSchema>;

/** The result of one bounded publish step. */
export type PublishStep =
  | { kind: 'done'; externalId: string; url: string; meta?: Record<string, unknown> }
  | { kind: 'pending'; checkpoint: PublishCheckpoint; pollAfterMs: number }
  | {
      kind: 'error';
      errorKind: PublishErrorKind;
      message: string;
      retryAfterMs?: number;
      /** Redacted platform response, for publish_attempts. Never include tokens. */
      raw?: unknown;
    };

/** Decrypted secrets for one connected account. Only the worker ever holds these. */
export interface AccountCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

/** Target-scoped token, e.g. a Facebook Page token. */
export interface ChannelCredentials {
  token: string;
}

/**
 * Thrown by an adapter's refreshToken() when the platform says the grant is gone
 * (revoked, expired refresh token). The account is marked needs_reauth.
 */
export class InvalidGrantError extends Error {
  constructor(message = 'invalid_grant') {
    super(message);
    this.name = 'InvalidGrantError';
  }
}
