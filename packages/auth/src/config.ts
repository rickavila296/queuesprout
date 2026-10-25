import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins';
import { schema, type Database } from '@queuesprout/db';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  db: Database;
  /** BETTER_AUTH_SECRET: 32+ random bytes. Signs cookies and encrypts stored OAuth tokens. */
  secret: string;
  /** PUBLIC_URL: the app's origin. Trusted origins are pinned to it. */
  baseUrl: string;
  /** Social sign-in is enabled only for providers with credentials configured. */
  google?: OAuthClient | undefined;
  github?: OAuthClient | undefined;
  sendMagicLink(input: { email: string; url: string }): Promise<void>;
}

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export function createAuth(config: AuthConfig) {
  return betterAuth({
    appName: 'QueueSprout',
    secret: config.secret,
    baseURL: config.baseUrl,
    trustedOrigins: [config.baseUrl],
    database: drizzleAdapter(config.db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    advanced: {
      // uuid ids so app.current_user_id() and the profile FKs stay uuid-typed.
      database: { generateId: 'uuid' },
      useSecureCookies: config.baseUrl.startsWith('https://'),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    account: {
      // Login-provider tokens are not needed after sign-in, but encrypt them anyway.
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, trustedProviders: ['google', 'github'] },
    },
    socialProviders: {
      ...(config.google && { google: { ...config.google, prompt: 'select_account' as const } }),
      ...(config.github && { github: config.github }),
    },
    rateLimit: {
      enabled: true,
      storage: 'memory',
      customRules: {
        '/sign-in/magic-link': { window: 60, max: 5 },
      },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        storeToken: 'hashed',
        sendMagicLink: ({ email, url }) => config.sendMagicLink({ email, url }),
      }),
      // Must be last: lets Server Actions set auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
