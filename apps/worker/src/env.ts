import { z } from 'zod';
import { parseKeyring, type Keyring } from '@queuesprout/core/credentials';
import { publishModeSchema } from '@queuesprout/shared';

const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Owner role: runs migrations and bypasses RLS. Never give this URL to apps/web. */
    WORKER_DATABASE_URL: z.url(),
    PUBLISH_MODE: publishModeSchema,
    /** AES-256-GCM key(s) for social account tokens; see .env.example. */
    TOKEN_ENCRYPTION_KEY: z
      .string({ error: 'TOKEN_ENCRYPTION_KEY is required (openssl rand -base64 32).' })
      .transform((value, ctx): Keyring => {
        try {
          return parseKeyring(value);
        } catch (error) {
          ctx.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : 'Invalid key.',
          });
          return z.NEVER;
        }
      }),
    /** The web app's origin; mock publishes link to its /mock/posts preview page. */
    PUBLIC_URL: z.url().default('http://localhost:3000'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Set to false when migrations run as a separate deploy step. */
    MIGRATE_ON_START: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .refine((e) => !(e.NODE_ENV === 'test' && e.PUBLISH_MODE === 'live'), {
    message: 'PUBLISH_MODE=live is never allowed in tests.',
    path: ['PUBLISH_MODE'],
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  const parsed = workerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
