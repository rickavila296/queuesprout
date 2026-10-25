-- Hand-written: roles, app schema, helper functions, triggers and RLS (ADR-014).
-- The migrating role owns every table, so it bypasses RLS; that is the worker role.
-- The web app connects as a login role that is a member of qs_web and cannot bypass RLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qs_web') THEN
    CREATE ROLE qs_web NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public, app TO qs_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qs_web;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO qs_web;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qs_web;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO qs_web;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint

-- Identity of the signed-in user for this transaction, set by withUser()/withWorkspace()
-- via set_config('app.user_id', ..., true). Null when unset.
CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint

-- True when the current user's role in ws is at least min_role (owner > admin > editor > viewer).
-- SECURITY DEFINER so policies on workspace_members can call it without recursing into RLS.
CREATE FUNCTION app.has_role(ws uuid, min_role member_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = ws
      AND m.user_id = app.current_user_id()
      AND array_position(enum_range(NULL::member_role), m.role)
       <= array_position(enum_range(NULL::member_role), min_role)
  )
$$;
--> statement-breakpoint

CREATE FUNCTION app.shares_workspace(other uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members mine
    JOIN workspace_members theirs ON theirs.workspace_id = mine.workspace_id
    WHERE mine.user_id = app.current_user_id() AND theirs.user_id = other
  )
$$;
--> statement-breakpoint

CREATE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER workspace_members_updated_at BEFORE UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Every Better Auth user gets a profile, whichever sign-in method created them.
CREATE FUNCTION app.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO profiles (id, display_name, avatar_url)
  VALUES (NEW.id, coalesce(nullif(NEW.name, ''), split_part(NEW.email, '@', 1)), NEW.image)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER user_create_profile AFTER INSERT ON "user"
  FOR EACH ROW EXECUTE FUNCTION app.handle_new_user();
--> statement-breakpoint

-- Creating a workspace inserts the workspace and its owner membership in one step.
-- Plain INSERTs cannot do it under RLS: nobody is a member of a workspace that does not exist yet.
CREATE FUNCTION app.create_workspace(p_name text, p_slug text, p_timezone text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid uuid := app.current_user_id();
  ws uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  INSERT INTO workspaces (name, slug, timezone, created_by)
  VALUES (p_name, p_slug, p_timezone, uid)
  RETURNING id INTO ws;
  INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (ws, uid, 'owner');
  RETURN ws;
END
$$;
--> statement-breakpoint

-- What the invite page shows before the user accepts. Knowing the token is the permission.
CREATE FUNCTION app.invite_preview(p_token_hash text)
RETURNS TABLE (workspace_name text, workspace_slug text, role member_role, email text,
               expires_at timestamptz, accepted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT w.name, w.slug, i.role, i.email, i.expires_at, i.accepted_at IS NOT NULL
  FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id
  WHERE i.token_hash = p_token_hash
$$;
--> statement-breakpoint

-- Accepts an invite for the current user. The signed-in email must match the invited email.
CREATE FUNCTION app.accept_invite(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid uuid := app.current_user_id();
  inv workspace_invites%ROWTYPE;
  user_email text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO inv FROM workspace_invites WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.expires_at < now() THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'P0001';
  END IF;
  SELECT u.email INTO user_email FROM "user" u WHERE u.id = uid;
  IF lower(user_email) IS DISTINCT FROM lower(inv.email) THEN
    RAISE EXCEPTION 'invite_email_mismatch' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (inv.workspace_id, uid, inv.role)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  UPDATE workspace_invites SET accepted_at = now(), accepted_by = uid WHERE id = inv.id;
  RETURN inv.workspace_id;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.has_role(uuid, member_role),
  app.shares_workspace(uuid), app.create_workspace(text, text, text),
  app.invite_preview(text), app.accept_invite(text) TO qs_web;
--> statement-breakpoint

-- Row-level security. Better Auth tables have none: only server code touches them.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profiles_read ON profiles FOR SELECT
  USING (id = app.current_user_id() OR app.shares_workspace(id));
--> statement-breakpoint
CREATE POLICY profiles_update_own ON profiles FOR UPDATE
  USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());
--> statement-breakpoint

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspaces_read ON workspaces FOR SELECT USING (app.has_role(id, 'viewer'));
--> statement-breakpoint
CREATE POLICY workspaces_update ON workspaces FOR UPDATE
  USING (app.has_role(id, 'admin')) WITH CHECK (app.has_role(id, 'admin'));
--> statement-breakpoint
CREATE POLICY workspaces_delete ON workspaces FOR DELETE USING (app.has_role(id, 'owner'));
--> statement-breakpoint

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY members_read ON workspace_members FOR SELECT
  USING (app.has_role(workspace_id, 'viewer'));
--> statement-breakpoint
CREATE POLICY members_update ON workspace_members FOR UPDATE
  USING (app.has_role(workspace_id, 'admin') AND role <> 'owner')
  WITH CHECK (app.has_role(workspace_id, 'admin') AND role <> 'owner');
--> statement-breakpoint
CREATE POLICY members_delete ON workspace_members FOR DELETE
  USING (app.has_role(workspace_id, 'admin') AND role <> 'owner');
--> statement-breakpoint

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invites_read ON workspace_invites FOR SELECT
  USING (app.has_role(workspace_id, 'admin'));
--> statement-breakpoint
CREATE POLICY invites_insert ON workspace_invites FOR INSERT
  WITH CHECK (app.has_role(workspace_id, 'admin') AND role <> 'owner'
              AND invited_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY invites_delete ON workspace_invites FOR DELETE
  USING (app.has_role(workspace_id, 'admin') AND accepted_at IS NULL);
