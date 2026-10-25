import 'server-only';
import { z } from 'zod';
import { publishModeSchema } from '@queuesprout/shared';

const optional = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Web role (member of qs_web): RLS applies. Never the worker/owner role. */
  DATABASE_URL: z.url(),
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters.'),
  PUBLISH_MODE: publishModeSchema,
  /**
   * Encrypts tokens when an account is connected (the worker decrypts them). Optional
   * here so pages render without it; connecting an account says what is missing.
   */
  TOKEN_ENCRYPTION_KEY: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().default('QueueSprout <hello@localhost>'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/** Parsed lazily so `next build` does not need runtime secrets. */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'test' && parsed.data.PUBLISH_MODE === 'live') {
    throw new Error('PUBLISH_MODE=live is never allowed in tests.');
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is required in production to send sign-in links.');
  }
  cached = parsed.data;
  return cached;
}
