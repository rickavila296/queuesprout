import type { z } from 'zod';
import type {
  AccountCredentials,
  AuthType,
  ChannelCredentials,
  PlatformLimits,
  PostItemKind,
  ProviderId,
  PublishCheckpoint,
  PublishStep,
  TargetType,
} from '@queuesprout/shared';

/**
 * The step-based adapter contract every channel implements (ADR-009, ADR-016).
 * Adding a channel never touches the scheduler. Adapters receive everything through
 * these contexts: they never read env vars or the database, and never log tokens.
 */

export interface ProviderCapabilities {
  /** Publishes post_items 1..n as replies to the previous item. */
  threads: boolean;
  /** Publishes a first_comment item under the post. */
  firstComment: boolean;
  /** Needs several steps with platform-side processing (container, poll, publish). */
  asyncProcessing: boolean;
  /** Publishes attached images. Absent until the adapter's media support ships. */
  media?: boolean;
}

export interface PostItem {
  id: string;
  position: number;
  kind: PostItemKind;
  body: string;
  mediaIds: string[];
  /**
   * When the item was stored. Stable across retries, so adapters can derive an
   * idempotency key from it (Bluesky's record key). The worker always sets it.
   */
  createdAt?: Date;
}

export interface ChannelPost<TSettings = Record<string, unknown>> {
  id: string;
  channelId: string;
  provider: ProviderId;
  /** The channel's default_settings merged with the post's settings. */
  settings: TSettings;
  items: PostItem[];
}

export interface MediaInfo {
  id: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  /** The item the issue is about; absent for post-level issues such as settings. */
  itemPosition?: number;
  field?: string;
}

/** What earlier items published as, for replies. */
export interface ItemRef {
  externalId: string;
  url: string | null;
  /** Bluesky {"uri", "cid"} and the like. */
  meta: Record<string, unknown>;
}

/** Media access for adapters (Phase 2). URLs are presigned GETs valid for 2 hours. */
export interface MediaResolver {
  getUrl(mediaId: string): Promise<string>;
  getInfo(mediaId: string): Promise<MediaInfo>;
}

/** The connected login a step publishes as. */
export interface AccountRef {
  /** The platform's account id (Bluesky DID, Mastodon account id). */
  externalId: string;
  /** The account's own server when it has one (Bluesky PDS, Mastodon instance). */
  serviceUrl: string | null;
}

export interface PublishContext<TSettings = Record<string, unknown>> {
  post: ChannelPost<TSettings>;
  /** The item this step works on. */
  item: PostItem;
  /** Previous item's ids, for replies. */
  parent: ItemRef | null;
  /** Item 0's ids (Bluesky replies need root + parent). */
  root: ItemRef | null;
  /** What earlier steps already did for this item. Never create a container when this has one. */
  checkpoint: PublishCheckpoint | null;
  creds: AccountCredentials;
  account: AccountRef;
  /** Target-scoped token, e.g. a Facebook Page token. */
  channelCreds: ChannelCredentials | null;
  /** The channel's target on the platform (page id, server channel id, chat id). */
  target: { type: TargetType; externalId: string };
  media: MediaResolver;
  /** Fires at the 60 s step deadline. Pass it to every fetch. */
  signal: AbortSignal;
  /** Injected clock, so checkpoints and deadlines are testable. */
  now: () => Date;
}

/** A destination under an account: profile, page, org, server channel, chat, board owner. */
export interface Target {
  targetType: TargetType;
  externalTargetId: string;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  defaultSettings?: Record<string, unknown>;
}

/** What a successful connect produces; apps/web encrypts creds before storing them. */
export interface ConnectedAccountInput {
  externalAccountId: string;
  displayName: string;
  /** The account's own server, stored on the account (Bluesky PDS). */
  serviceUrl?: string | null;
  creds: AccountCredentials;
  /** Targets known at connect time; others come from listTargets(). */
  targets: Target[];
}

export interface AuthContext {
  /** Opaque state to send to the provider; only its hash is stored. */
  state: string;
  redirectUri: string;
  clientId: string;
  /** Mastodon instance origin, or a self-hosted platform's base URL. */
  instanceUrl?: string;
}

/** For providers that register an OAuth app per server (Mastodon instances). */
export interface AppRegistrationContext {
  instanceUrl: string;
  redirectUri: string;
  /** Shown to the user on the server's consent screen. */
  clientName: string;
  website: string;
  signal: AbortSignal;
}

/** apps/web encrypts clientSecret into provider_apps; it is never shown or logged. */
export interface RegisteredApp {
  clientId: string;
  clientSecret: string;
}

/** Secrets returned here (PKCE verifier, DPoP key) are encrypted into oauth_sessions. */
export interface AuthStart {
  url: string;
  codeVerifier?: string;
  dpopJwk?: string;
}

export interface CallbackContext {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  codeVerifier?: string;
  dpopJwk?: string;
  instanceUrl?: string;
  signal: AbortSignal;
}

/**
 * Thrown by connect calls (exchangeCode, connectWithSecret) with a message that is safe
 * to show the user. Never include the secret the user typed.
 */
export class ConnectError extends Error {
  constructor(
    public readonly code: 'invalid_credentials' | 'rate_limited' | 'unavailable' | 'rejected',
    message: string,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

/** For app_password and bot_token providers: the user pastes a secret instead of an OAuth hop. */
export interface SecretConnectContext {
  identifier: string;
  secret: string;
  instanceUrl?: string;
  signal: AbortSignal;
}

/**
 * The parts of an adapter that are safe in the browser and in apps/web: limits,
 * settings and validation. Exported from "@queuesprout/providers/client".
 */
export interface ProviderDefinition<TSettings = Record<string, unknown>> {
  id: ProviderId;
  authType: AuthType;
  limits: PlatformLimits;
  settingsSchema: z.ZodType<TSettings>;
  capabilities: ProviderCapabilities;
  validate(post: ChannelPost<TSettings>, media: MediaInfo[]): ValidationIssue[];
}

export interface ProviderAdapter<
  TSettings = Record<string, unknown>,
> extends ProviderDefinition<TSettings> {
  /** OAuth providers. registerApp only where each server needs its own app. */
  registerApp?(ctx: AppRegistrationContext): Promise<RegisteredApp>;
  getAuthUrl?(ctx: AuthContext): Promise<AuthStart>;
  exchangeCode?(ctx: CallbackContext): Promise<ConnectedAccountInput>;
  /** app_password and bot_token providers. */
  connectWithSecret?(ctx: SecretConnectContext): Promise<ConnectedAccountInput>;
  /** Throw InvalidGrantError (from shared) when the grant is revoked. Worker only. */
  refreshToken(
    creds: AccountCredentials,
    signal: AbortSignal,
    account: AccountRef,
  ): Promise<AccountCredentials>;
  listTargets(
    creds: AccountCredentials,
    signal: AbortSignal,
    account: AccountRef,
  ): Promise<Target[]>;

  /** One bounded step (< 60 s): returns done, pending or error, never throws. Worker only. */
  publish(ctx: PublishContext<TSettings>): Promise<PublishStep>;
  deletePost?(externalId: string, creds: AccountCredentials, signal: AbortSignal): Promise<void>;
}
