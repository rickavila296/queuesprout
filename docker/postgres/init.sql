-- Runs once, when the Postgres volume is first created.
-- queuesprout (POSTGRES_USER) owns the schema and runs migrations: that is the worker role.
-- queuesprout_web logs in for apps/web. It inherits qs_web and cannot bypass RLS.
-- Change both passwords for anything beyond local development.
CREATE ROLE qs_web NOLOGIN NOBYPASSRLS;
CREATE ROLE queuesprout_web LOGIN PASSWORD 'queuesprout_web' NOBYPASSRLS IN ROLE qs_web;
