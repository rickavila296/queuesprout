-- OAuth apps registered per server (Mastodon instances). The web role cannot read
-- provider_apps; these functions hand it one app's encrypted client secret when an
-- admin connects an account, and store a newly registered app.

CREATE FUNCTION app.find_provider_app(
  p_workspace_id uuid,
  p_provider provider_id,
  p_instance_url text
) RETURNS TABLE (id uuid, instance_url text, client_id text, client_secret_enc bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT app.has_role(p_workspace_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT a.id, a.instance_url, a.client_id, a.client_secret_enc
    FROM provider_apps a
    WHERE a.provider = p_provider AND a.instance_url = p_instance_url;
END
$$;
--> statement-breakpoint
-- By id, for the OAuth callback: only for the caller's own unexpired session.
CREATE FUNCTION app.provider_app_for_session(p_session_id uuid)
RETURNS TABLE (id uuid, instance_url text, client_id text, client_secret_enc bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
    SELECT a.id, a.instance_url, a.client_id, a.client_secret_enc
    FROM oauth_sessions s
    JOIN provider_apps a ON a.id = s.provider_app_id
    WHERE s.id = p_session_id
      AND s.user_id = app.current_user_id()
      AND s.expires_at > now()
      AND app.has_role(s.workspace_id, 'admin');
END
$$;
--> statement-breakpoint
-- Stores a newly registered app. If another request registered the same instance first,
-- keeps that one and returns it, so every workspace shares one app per instance.
CREATE FUNCTION app.save_provider_app(
  p_workspace_id uuid,
  p_provider provider_id,
  p_instance_url text,
  p_client_id text,
  p_client_secret_enc bytea,
  p_key_version smallint
) RETURNS TABLE (id uuid, instance_url text, client_id text, client_secret_enc bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT app.has_role(p_workspace_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_instance_url !~ '^https://[^/]+$' THEN
    RAISE EXCEPTION 'invalid_instance_url' USING ERRCODE = '22023';
  END IF;
  INSERT INTO provider_apps (provider, instance_url, client_id, client_secret_enc, key_version)
  VALUES (p_provider, p_instance_url, p_client_id, p_client_secret_enc, p_key_version)
  ON CONFLICT (provider, instance_url) DO NOTHING;
  RETURN QUERY
    SELECT a.id, a.instance_url, a.client_id, a.client_secret_enc
    FROM provider_apps a
    WHERE a.provider = p_provider AND a.instance_url = p_instance_url;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.find_provider_app(uuid, provider_id, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.provider_app_for_session(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.save_provider_app(uuid, provider_id, text, text, bytea, smallint)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.find_provider_app(uuid, provider_id, text) TO qs_web;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.provider_app_for_session(uuid) TO qs_web;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.save_provider_app(uuid, provider_id, text, text, bytea, smallint)
  TO qs_web;
