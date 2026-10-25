import 'server-only';
import { createAuth, MAGIC_LINK_TTL_SECONDS, type Auth } from '@queuesprout/auth';
import { env } from '@/env';
import { db } from './db';
import { linkEmail, sendEmail } from './email';

const globalForAuth = globalThis as unknown as { qsAuth?: Auth };

export function auth(): Auth {
  if (globalForAuth.qsAuth) return globalForAuth.qsAuth;
  const e = env();
  globalForAuth.qsAuth = createAuth({
    db: db(),
    secret: e.BETTER_AUTH_SECRET,
    baseUrl: e.PUBLIC_URL,
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
        : undefined,
    github:
      e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET
        ? { clientId: e.GITHUB_CLIENT_ID, clientSecret: e.GITHUB_CLIENT_SECRET }
        : undefined,
    async sendMagicLink({ email, url }) {
      const minutes = Math.round(MAGIC_LINK_TTL_SECONDS / 60);
      await sendEmail({
        to: email,
        subject: 'Your QueueSprout sign-in link',
        ...linkEmail({
          heading: 'Sign in to QueueSprout',
          body: `This link signs you in and expires in ${minutes} minutes.`,
          cta: 'Sign in',
          url,
        }),
      });
    },
  });
  return globalForAuth.qsAuth;
}

export function enabledSocialProviders(): { google: boolean; github: boolean } {
  const e = env();
  return {
    google: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    github: Boolean(e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET),
  };
}
