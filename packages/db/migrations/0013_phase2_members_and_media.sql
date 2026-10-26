-- Hand-written: fixes from the Phase 2 walkthrough.

-- An invite for someone who is already a member changes their role instead of being
-- accepted with no effect. The owner's role is never changed by an invite.
CREATE OR REPLACE FUNCTION app.accept_invite(p_token_hash text) RETURNS uuid
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
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
  WHERE workspace_members.role <> 'owner';
  UPDATE workspace_invites SET accepted_at = now(), accepted_by = uid WHERE id = inv.id;
  RETURN inv.workspace_id;
END
$$;
--> statement-breakpoint

-- True while a post that may still publish uses the file, or a post that failed within the
-- last p_failed_hold_days (it may be retried). media.retention and app.delete_media share it.
CREATE FUNCTION app.media_needed_by_post(p_media_id uuid, p_now timestamptz, p_failed_hold_days int)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM post_item_media pim
    JOIN post_items pi ON pi.id = pim.post_item_id
    JOIN posts p ON p.id = pi.post_id
    WHERE pim.media_id = p_media_id
      AND (p.status NOT IN ('published', 'cancelled', 'failed')
        OR (p.status = 'failed'
          AND p.updated_at > p_now - make_interval(days => p_failed_hold_days)))
  )
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.media_needed_by_post(uuid, timestamptz, int) FROM PUBLIC;
--> statement-breakpoint

-- Deleting from the library. A file no post needs is purged at once, so its bytes go back
-- to the quota right away; media.retention removes the objects on its next run. A file a
-- scheduled post still uses stays charged until media.retention purges it later.
-- Returns false when the file is not there or the caller is not an editor.
CREATE FUNCTION app.delete_media(p_workspace_id uuid, p_media_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m media_assets%ROWTYPE;
BEGIN
  SELECT * INTO m FROM media_assets
  WHERE id = p_media_id AND workspace_id = p_workspace_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT app.has_role(m.workspace_id, 'editor') THEN
    RETURN false;
  END IF;
  UPDATE media_assets SET deleted_at = now() WHERE id = m.id;
  -- Uploads still in flight were never charged; media.retention clears them after 24 hours.
  -- 30 days mirrors MEDIA_RETENTION.failedPostHoldDays.
  IF m.status IN ('processing', 'ready', 'failed')
     AND NOT app.media_needed_by_post(m.id, now(), 30) THEN
    UPDATE media_assets SET status = 'purged' WHERE id = m.id;
    UPDATE workspaces SET storage_bytes_used = greatest(0, storage_bytes_used - m.bytes)
    WHERE id = m.workspace_id;
  END IF;
  RETURN true;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.delete_media(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.delete_media(uuid, uuid) TO qs_web;
