import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Either a pooled connection or a transaction; for definer functions that need no user. */
export type Queryable = Database | Tx;

export interface CreateDbOptions {
  /** Pool size. Keep it small on serverless hosts. */
  max?: number;
  applicationName?: string;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): Database {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'queuesprout',
  });
  return drizzle(pool, { schema });
}

/** Fails fast when the database is unreachable. */
export async function ping(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}

export { schema };
