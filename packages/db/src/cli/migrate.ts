import { createDb } from '../client';
import { runMigrations } from '../migrate';

const url = process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set WORKER_DATABASE_URL (the owner role) to run migrations.');
  process.exit(1);
}

const db = createDb(url, {
  max: 2,
  applicationName: 'queuesprout-migrate',
  sslCa: process.env.DATABASE_SSL_CA || undefined,
});
try {
  await runMigrations(db);
  console.log('Migrations applied.');
} finally {
  await db.$client.end();
}
