import { z } from 'zod';
import { publishModeSchema } from '@queuesprout/shared';

const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Owner role: runs migrations and bypasses RLS. Never give this URL to apps/web. */
    WORKER_DATABASE_URL: z.url(),
    PUBLISH_MODE: publishModeSchema,
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
