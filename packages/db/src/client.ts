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
  /**
   * CA certificate (PEM, or the PEM base64-encoded) of a database that uses a private CA,
   * such as Supabase. The connection then requires TLS and verifies the server against it.
   */
  sslCa?: string | undefined;
}

export interface PgConnection {
  connectionString: string;
  ssl?: { ca: string; rejectUnauthorized: true };
}

/** Accepts a PEM certificate as is, or base64-encoded (easier to put in a one-line env var). */
export function decodeCaCert(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed;
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
  if (!decoded.startsWith('-----BEGIN CERTIFICATE-----')) {
    throw new Error('DATABASE_SSL_CA must be a PEM certificate or a base64-encoded one.');
  }
  return decoded;
}

/**
 * Connection settings for pg (and pg-boss). With a CA, TLS is verified against it. Any
 * sslmode in the URL is dropped then: pg lets the URL's ssl settings override the `ssl`
 * option, and sslmode=require would replace the CA check with node's default trust store.
 */
export function pgConnection(connectionString: string, sslCa?: string): PgConnection {
  if (!sslCa) return { connectionString };
  const url = new URL(connectionString);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) {
    url.searchParams.delete(key);
  }
  return {
    connectionString: url.toString(),
    ssl: { ca: decodeCaCert(sslCa), rejectUnauthorized: true },
  };
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): Database {
  const pool = new pg.Pool({
    ...pgConnection(connectionString, options.sslCa),
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
