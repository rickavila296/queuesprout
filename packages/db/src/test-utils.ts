import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, type Database } from './client';
import { runMigrations } from './migrate';

export interface TestDatabase {
  /** Owner role: bypasses RLS, like the worker. */
  owner: Database;
  /** Login role in qs_web: subject to RLS, like apps/web. */
  web: Database;
  /** Connection string for the owner role, for processes the test starts (the worker). */
  ownerUrl: string;
  drop(): Promise<void>;
}

/**
 * Creates a throwaway database on the server in TEST_DATABASE_URL (a role that can
 * CREATEDB and CREATEROLE), migrates it, and returns owner and web connections.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) throw new Error('Set TEST_DATABASE_URL to run integration tests.');

  const name = `qs_test_${randomBytes(4).toString('hex')}`;
  const webRole = 'qs_test_web';
  const webPassword = 'qs_test_web';

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  // Roles are cluster-wide and test files run in parallel: without the lock, two files
  // can both see a role missing and the second CREATE ROLE fails.
  await admin.query('begin');
  await admin.query('select pg_advisory_xact_lock(7301993002)');
  await admin.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'qs_web') then
        create role qs_web nologin nobypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = '${webRole}') then
        create role ${webRole} login password '${webPassword}' in role qs_web;
      end if;
    end $$;`);
  await admin.query('commit');
  await admin.end();

  const ownerUrl = new URL(adminUrl);
  ownerUrl.pathname = `/${name}`;
  const webUrl = new URL(ownerUrl);
  webUrl.username = webRole;
  webUrl.password = webPassword;

  const owner = createDb(ownerUrl.toString(), { max: 2 });
  await runMigrations(owner);
  const web = createDb(webUrl.toString(), { max: 4 });

  return {
    owner,
    web,
    ownerUrl: ownerUrl.toString(),
    async drop() {
      await web.$client.end();
      await owner.$client.end();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}
