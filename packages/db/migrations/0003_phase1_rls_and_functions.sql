-- Hand-written: Phase 1 privileges, triggers, functions and RLS for accounts, channels and posts.
-- Same model as 0001: the owner (worker) role bypasses RLS; qs_web is subject to it.

-- Secrets: the web role gets no privileges at all, on top of RLS with no policies (ADR-010).
-- Default privileges from 0001 granted them, so take them back explicitly.
REVOKE ALL ON account_credentials, provider_apps FROM qs_web;
--> statement-breakpoint
ALTER TABLE account_credentials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE provider_apps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Publishing history is written by the worker only.
REVOKE INSERT, UPDATE, DELETE ON publish_attempts FROM qs_web;
--> statement-breakpoint

CREATE TRIGGER provider_apps_updated_at BEFORE UPDATE ON provider_apps
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER connected_accounts_updated_at BEFORE UPDATE ON connected_accounts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER account_credentials_updated_at BEFORE UPDATE ON account_credentials
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER channels_updated_at BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER post_groups_updated_at BEFORE UPDATE ON post_groups
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER posts_updated_at BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER post_items_updated_at BEFORE UPDATE ON post_items
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Connecting an account stores its encrypted secrets, which the web role cannot write directly.
-- Admins only. Reconnecting the same external account replaces its secrets and reactivates it.
-- Returns the account id.
CREATE FUNCTION app.connect_account(
  p_workspace_id uuid,
  p_provider provider_id,
  p_provider_app_id uuid,
  p_external_account_id text,
  p_display_name text,
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
    (workspace_id, provider, provider_app_id, external_account_id, display_name, status, connected_by)
  VALUES
    (p_workspace_id, p_provider, p_provider_app_id, p_external_account_id, p_display_name, 'active', uid)
  ON CONFLICT (workspace_id, provider, external_account_id) DO UPDATE
    SET display_name = excluded.display_name,
        provider_app_id = excluded.provider_app_id,
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
REVOKE EXECUTE ON FUNCTION app.connect_account(uuid, provider_id, uuid, text, text, bytea, bytea,
  timestamptz, text[], smallint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.connect_account(uuid, provider_id, uuid, text, text, bytea, bytea,
  timestamptz, text[], smallint) TO qs_web;
--> statement-breakpoint

-- Only the worker moves a post through queued, publishing, processing, published and failed,
-- and once a post is in flight or published, users cannot change it.
-- row_security_active() is true exactly for roles RLS applies to, i.e. the web role; the
-- owner (worker) role skips these checks. version is bumped on every update for both.
CREATE FUNCTION app.guard_post() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.version = OLD.version + 1;
  END IF;
  IF NOT row_security_active('public.posts') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('queued', 'publishing', 'processing', 'published') THEN
    RAISE EXCEPTION 'post_locked' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IN ('queued', 'publishing', 'processing', 'published', 'failed')
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'worker_only_status' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.external_id IS NOT NULL OR NEW.external_url IS NOT NULL
       OR NEW.external_container_id IS NOT NULL OR NEW.publish_checkpoint IS NOT NULL
       OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'worker_only_field' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.external_id IS DISTINCT FROM OLD.external_id
     OR NEW.external_url IS DISTINCT FROM OLD.external_url
     OR NEW.external_container_id IS DISTINCT FROM OLD.external_container_id
     OR NEW.publish_checkpoint IS DISTINCT FROM OLD.publish_checkpoint
     OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'worker_only_field' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER posts_guard BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION app.guard_post();
--> statement-breakpoint

-- Items of an in-flight or published post are locked for users, and their publish results
-- (status, external ids, published_at) are written by the worker only.
CREATE FUNCTION app.guard_post_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status post_status;
  item post_items%ROWTYPE;
BEGIN
  IF NOT row_security_active('public.post_items') THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  item := coalesce(NEW, OLD);
  SELECT p.status INTO parent_status FROM posts p WHERE p.id = item.post_id;
  IF parent_status IN ('queued', 'publishing', 'processing', 'published') THEN
    RAISE EXCEPTION 'post_locked' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.external_id IS NOT NULL OR NEW.external_url IS NOT NULL
       OR NEW.external_meta <> '{}'::jsonb OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'worker_only_field' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.external_id IS DISTINCT FROM OLD.external_id
       OR NEW.external_url IS DISTINCT FROM OLD.external_url
       OR NEW.external_meta IS DISTINCT FROM OLD.external_meta
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'worker_only_field' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER post_items_guard BEFORE INSERT OR UPDATE OR DELETE ON post_items
  FOR EACH ROW EXECUTE FUNCTION app.guard_post_item();
--> statement-breakpoint

-- Row-level security. Viewers read; admins manage accounts and channels; editors write posts.
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY accounts_read ON connected_accounts FOR SELECT
  USING (app.has_role(workspace_id, 'viewer'));
--> statement-breakpoint
CREATE POLICY accounts_update ON connected_accounts FOR UPDATE
  USING (app.has_role(workspace_id, 'admin')) WITH CHECK (app.has_role(workspace_id, 'admin'));
--> statement-breakpoint
CREATE POLICY accounts_delete ON connected_accounts FOR DELETE
  USING (app.has_role(workspace_id, 'admin'));
--> statement-breakpoint
-- No INSERT policy: accounts are created with their secrets by app.connect_account().

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY channels_read ON channels FOR SELECT USING (app.has_role(workspace_id, 'viewer'));
--> statement-breakpoint
CREATE POLICY channels_write ON channels FOR ALL
  USING (app.has_role(workspace_id, 'admin')) WITH CHECK (app.has_role(workspace_id, 'admin'));
--> statement-breakpoint

ALTER TABLE oauth_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY oauth_own ON oauth_sessions FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id() AND app.has_role(workspace_id, 'admin'));
--> statement-breakpoint

ALTER TABLE post_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY post_groups_read ON post_groups FOR SELECT
  USING (app.has_role(workspace_id, 'viewer'));
--> statement-breakpoint
CREATE POLICY post_groups_write ON post_groups FOR ALL
  USING (app.has_role(workspace_id, 'editor')) WITH CHECK (app.has_role(workspace_id, 'editor'));
--> statement-breakpoint

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY posts_read ON posts FOR SELECT USING (app.has_role(workspace_id, 'viewer'));
--> statement-breakpoint
CREATE POLICY posts_write ON posts FOR ALL
  USING (app.has_role(workspace_id, 'editor')) WITH CHECK (app.has_role(workspace_id, 'editor'));
--> statement-breakpoint

ALTER TABLE post_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY post_items_read ON post_items FOR SELECT
  USING (app.has_role(workspace_id, 'viewer'));
--> statement-breakpoint
CREATE POLICY post_items_write ON post_items FOR ALL
  USING (app.has_role(workspace_id, 'editor')) WITH CHECK (app.has_role(workspace_id, 'editor'));
--> statement-breakpoint

ALTER TABLE publish_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY publish_attempts_read ON publish_attempts FOR SELECT
  USING (app.has_role(workspace_id, 'viewer'));
