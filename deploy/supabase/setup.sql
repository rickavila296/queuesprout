-- QueueSprout on Supabase: run once in the SQL editor (as postgres), before the worker's
-- first start. The worker then creates every table itself (MIGRATE_ON_START=true).
--
-- Roles, as in docker/postgres/init.sql:
--   queuesprout      owns the schema and runs migrations: the worker role. As the table
--                    owner it bypasses RLS, so only the worker may hold its password.
--   qs_web           NOLOGIN group that every RLS policy and grant targets.
--   queuesprout_web  logs in for apps/web (Vercel). Member of qs_web, cannot bypass RLS.
--
-- Replace both passwords with long random strings of letters and digits only (no @ : / ?),
-- so they can go into connection URLs as they are.

CREATE ROLE queuesprout LOGIN PASSWORD 'REPLACE_WITH_WORKER_PASSWORD' NOBYPASSRLS;
CREATE ROLE qs_web NOLOGIN NOBYPASSRLS;
CREATE ROLE queuesprout_web LOGIN PASSWORD 'REPLACE_WITH_WEB_PASSWORD' NOBYPASSRLS IN ROLE qs_web;

-- The worker creates the app, drizzle and pgboss schemas and the tables in public.
GRANT CREATE ON DATABASE postgres TO queuesprout;
GRANT USAGE, CREATE ON SCHEMA public TO queuesprout;

-- Supabase's Data API (PostgREST) serves the public schema to its anon and authenticated
-- roles. QueueSprout never uses it: turn it off in the dashboard (see the deploy guide).
-- Supabase's default grants to those roles are set up for objects its own roles create,
-- and the worker creates everything as queuesprout. After the worker's first start, check
-- that this returns no rows:
--   SELECT table_schema, table_name, grantee FROM information_schema.role_table_grants
--   WHERE grantee IN ('anon', 'authenticated')
--     AND table_schema IN ('public', 'app', 'pgboss', 'drizzle');
-- If it does, remove them:
--   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
