-- app.connect_account() now also stores the account's own server (service_url).
DROP FUNCTION app.connect_account(uuid, provider_id, uuid, text, text, bytea, bytea,
  timestamptz, text[], smallint);
--> statement-breakpoint
CREATE FUNCTION app.connect_account(
  p_workspace_id uuid,
  p_provider provider_id,
  p_provider_app_id uuid,
  p_external_account_id text,
  p_display_name text,
  p_service_url text,
  p_access_token_enc bytea,
  p_refresh_token_enc bytea,
  p_expires_at timestamptz,
  p_scopes text[],
  p_key_version smallint
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid uuid := app.current_user_id();
  acct uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT app.has_role(p_workspace_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO connected_accounts
    (workspace_id, provider, provider_app_id, external_account_id, display_name, service_url,
     status, connected_by)
  VALUES
    (p_workspace_id, p_provider, p_provider_app_id, p_external_account_id, p_display_name,
     p_service_url, 'active', uid)
  ON CONFLICT (workspace_id, provider, external_account_id) DO UPDATE
    SET display_name = excluded.display_name,
        provider_app_id = excluded.provider_app_id,
        service_url = excluded.service_url,
        status = 'active',
        connected_by = excluded.connected_by
  RETURNING id INTO acct;
  INSERT INTO account_credentials
    (account_id, access_token_enc, refresh_token_enc, expires_at, scopes, key_version, refreshed_at)
  VALUES
    (acct, p_access_token_enc, p_refresh_token_enc, p_expires_at, coalesce(p_scopes, '{}'),
     p_key_version, now())
  ON CONFLICT (account_id) DO UPDATE
    SET access_token_enc = excluded.access_token_enc,
        refresh_token_enc = excluded.refresh_token_enc,
        expires_at = excluded.expires_at,
        scopes = excluded.scopes,
        key_version = excluded.key_version,
        refreshed_at = now();
  RETURN acct;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.connect_account(uuid, provider_id, uuid, text, text, text, bytea,
  bytea, timestamptz, text[], smallint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.connect_account(uuid, provider_id, uuid, text, text, text, bytea,
  bytea, timestamptz, text[], smallint) TO qs_web;
--> statement-breakpoint

-- The worker sends the account's tokens to service_url, so users cannot change it after
-- connecting; reconnecting (through app.connect_account) is the only way to set it.
CREATE FUNCTION app.guard_account() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF row_security_active('public.connected_accounts')
     AND NEW.service_url IS DISTINCT FROM OLD.service_url THEN
    RAISE EXCEPTION 'worker_only_field' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER connected_accounts_guard BEFORE UPDATE ON connected_accounts
  FOR EACH ROW EXECUTE FUNCTION app.guard_account();
