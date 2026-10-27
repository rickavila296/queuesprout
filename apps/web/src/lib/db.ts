import 'server-only';
import { createDataAccess, createDb, type Database, type DataAccess } from '@queuesprout/db';
import { env } from '@/env';

const globalForDb = globalThis as unknown as { qsDb?: Database; qsDataAccess?: DataAccess };

/** One pool per server process (and per dev hot reload). */
export function db(): Database {
  globalForDb.qsDb ??= createDb(env().DATABASE_URL, {
    max: 5,
    applicationName: 'queuesprout-web',
    sslCa: env().DATABASE_SSL_CA,
  });
  return globalForDb.qsDb;
}

export function dataAccess(): DataAccess {
  globalForDb.qsDataAccess ??= createDataAccess(db());
  return globalForDb.qsDataAccess;
}
