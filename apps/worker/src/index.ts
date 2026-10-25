import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PgBoss } from 'pg-boss';
import { createDb, ping } from '@queuesprout/db';
import { MIGRATIONS_FOLDER, runMigrations } from '@queuesprout/db/migrate';
import { parseWorkerEnv } from './env';
import { createLogger } from './logger';

const env = parseWorkerEnv(process.env);
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

/** Queue names. Phase 1 adds publish.step, dispatcher and token.refresh. */
const QUEUES = { heartbeat: 'system.heartbeat' } as const;

/** dist/migrations in the built image; packages/db/migrations under tsx. */
function migrationsFolder(): string {
  const bundled = fileURLToPath(new URL('./migrations', import.meta.url));
  return existsSync(bundled) ? bundled : MIGRATIONS_FOLDER;
}

async function main(): Promise<void> {
  const db = createDb(env.WORKER_DATABASE_URL, { max: 5, applicationName: 'queuesprout-worker' });
  await ping(db);

  if (env.MIGRATE_ON_START) {
    await runMigrations(db, migrationsFolder());
    log.info('migrations up to date');
  }

  const boss = new PgBoss({
    connectionString: env.WORKER_DATABASE_URL,
    application_name: 'queuesprout-worker-boss',
    schema: 'pgboss',
    max: 5,
  });
  boss.on('error', (error) => log.error({ err: error }, 'pg-boss error'));
  await boss.start();

  await boss.createQueue(QUEUES.heartbeat);
  await boss.schedule(QUEUES.heartbeat, '* * * * *');
  await boss.work(QUEUES.heartbeat, async () => {
    log.debug('heartbeat');
  });

  log.info({ publishMode: env.PUBLISH_MODE }, 'worker started');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    // Lets in-flight jobs finish (each publish step is bounded to 60 s).
    await boss.stop({ graceful: true, timeout: 70_000 });
    await db.$client.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, 'worker failed to start');
  process.exit(1);
});
