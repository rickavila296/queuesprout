import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PgBoss } from 'pg-boss';
import { createDb, ping } from '@queuesprout/db';
import { checkBucket, createStorage } from '@queuesprout/storage';
import { MIGRATIONS_FOLDER, runMigrations } from '@queuesprout/db/migrate';
import { createAdapterPicker } from './adapters';
import { parseWorkerEnv } from './env';
import { createLogger } from './logger';
import { probeMediaOnce } from './media/probe';
import { runMediaRetention } from './media/retention';
import { sendFailureEmails } from './notifications/failures';
import { logMailer, resendMailer } from './notifications/mailer';
import { dispatchOnce, type Enqueue } from './publishing/dispatcher';
import { refreshExpiringTokens } from './publishing/refresh';
import { runStep, type PipelineDeps } from './publishing/step';

const env = parseWorkerEnv(process.env);
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

const QUEUES = {
  heartbeat: 'system.heartbeat',
  publishStep: 'publish.step',
  tokenRefresh: 'token.refresh',
  failureEmails: 'notify.failures',
  mediaRetention: 'media.retention',
} as const;

/** The dispatcher reads due posts from Postgres this often. */
const DISPATCH_INTERVAL_MS = 15_000;
/** New uploads are checked this often, so the library shows them ready within seconds. */
const PROBE_INTERVAL_MS = 5_000;

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

  const storage =
    env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? createStorage({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : null;
  if (storage) await checkBucket(storage);

  const deps: PipelineDeps = {
    db,
    keyring: env.TOKEN_ENCRYPTION_KEY,
    pickAdapter: createAdapterPicker(env),
    now: () => new Date(),
    log,
    storage,
  };

  // stately: at most one queued and one active step per post (singletonKey = post id).
  await boss.createQueue(QUEUES.publishStep, {
    policy: 'stately',
    expireInSeconds: 300,
    retryLimit: 2,
    retryDelay: 30,
  });
  const enqueue: Enqueue = async (postId, runAt) => {
    await boss.send(
      QUEUES.publishStep,
      { postId },
      { singletonKey: postId, ...(runAt && { startAfter: runAt }) },
    );
  };
  await boss.work<{ postId: string }>(
    QUEUES.publishStep,
    { localConcurrency: 5 },
    async ([job]) => {
      if (!job) return;
      const follow = await runStep(deps, job.data.postId);
      if (follow.next === 'now') await enqueue(job.data.postId);
      if (follow.next === 'at') await enqueue(job.data.postId, follow.at);
    },
  );

  await boss.createQueue(QUEUES.tokenRefresh, { policy: 'singleton' });
  await boss.schedule(QUEUES.tokenRefresh, '*/10 * * * *');
  await boss.work(QUEUES.tokenRefresh, async () => {
    const summary = await refreshExpiringTokens(deps);
    log.info(summary, 'token refresh finished');
  });

  if (env.RESEND_API_KEY || env.NODE_ENV !== 'production') {
    const mail = env.RESEND_API_KEY
      ? resendMailer(env.RESEND_API_KEY, env.EMAIL_FROM)
      : logMailer(log);
    await boss.createQueue(QUEUES.failureEmails, { policy: 'singleton' });
    await boss.schedule(QUEUES.failureEmails, '* * * * *');
    await boss.work(QUEUES.failureEmails, async () => {
      const summary = await sendFailureEmails({
        db,
        mail,
        publicUrl: env.PUBLIC_URL,
        now: () => new Date(),
        log,
      });
      if (summary.sent + summary.skipped + summary.errors > 0) {
        log.info(summary, 'failure emails sent');
      }
    });
  } else {
    // Leaves failures unmarked, so they are emailed once a key is set.
    await boss.unschedule(QUEUES.failureEmails).catch(() => undefined);
    log.warn('RESEND_API_KEY is not set: failure emails are off');
  }

  let dispatching = false;
  const dispatcher = setInterval(() => {
    if (dispatching) return;
    dispatching = true;
    dispatchOnce(db, enqueue, new Date())
      .then((n) => n > 0 && log.info({ claimed: n }, 'dispatched posts'))
      .catch((error: unknown) => log.error({ err: error }, 'dispatch failed'))
      .finally(() => {
        dispatching = false;
      });
  }, DISPATCH_INTERVAL_MS);

  if (storage) {
    await boss.createQueue(QUEUES.mediaRetention, { policy: 'singleton' });
    await boss.schedule(QUEUES.mediaRetention, '*/10 * * * *');
    await boss.work(QUEUES.mediaRetention, async () => {
      const summary = await runMediaRetention({ db, storage, now: () => new Date(), log });
      if (summary.purged + summary.removed + summary.errors > 0) {
        log.info(summary, 'media retention finished');
      }
    });
  } else {
    // Without storage nothing can be removed; files wait until S3_* is set.
    await boss.unschedule(QUEUES.mediaRetention).catch(() => undefined);
  }

  let prober: NodeJS.Timeout | undefined;
  if (storage) {
    let probing = false;
    prober = setInterval(() => {
      if (probing) return;
      probing = true;
      probeMediaOnce({ db, storage, log })
        .then((s) => s.ready + s.failed > 0 && log.info(s, 'media checked'))
        .catch((error: unknown) => log.error({ err: error }, 'media probe failed'))
        .finally(() => {
          probing = false;
        });
    }, PROBE_INTERVAL_MS);
  } else {
    log.warn('S3_* is not set: uploads stay at "Checking" and posts with images fail');
  }

  log.info({ publishMode: env.PUBLISH_MODE }, 'worker started');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    clearInterval(dispatcher);
    clearInterval(prober);
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
