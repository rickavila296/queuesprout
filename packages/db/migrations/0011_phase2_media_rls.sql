-- Hand-written: Phase 2 media privileges, guards, upload functions and RLS.
-- Same model as 0003: the owner (worker) role bypasses RLS and the guards; qs_web is subject to both.

CREATE TRIGGER media_assets_updated_at BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER post_item_media_updated_at BEFORE UPDATE ON post_item_media
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Per-workspace storage cap in bytes (500 MB). Mirrored by WORKSPACE_STORAGE_QUOTA_BYTES in
-- @queuesprout/shared for the UI; this is the one that is enforced.
CREATE FUNCTION app.storage_quota_bytes() RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT 524288000::bigint $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.storage_quota_bytes() TO qs_web;
--> statement-breakpoint

-- Users may rename, re-file (retention) and soft-delete media. What the file is and where it
-- lives is fixed at reserve time, and what the worker learns about it is the worker's to write.
-- Rows are only created through app.reserve_media() and never hard-deleted by users.
CREATE FUNCTION app.guard_media_asset() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT row_security_active('public.media_assets') THEN
    RETURN NEW;
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.mime IS DISTINCT FROM OLD.mime
     OR NEW.bytes IS DISTINCT FROM OLD.bytes
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.width IS DISTINCT FROM OLD.width
     OR NEW.height IS DISTINCT FROM OLD.height
     OR NEW.duration_ms IS DISTINCT FROM OLD.duration_ms
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.thumbnail_key IS DISTINCT FROM OLD.thumbnail_key
     OR NEW.variants IS DISTINCT FROM OLD.variants
     OR NEW.error_message IS DISTINCT FROM OLD.error_message
     OR NEW.last_used_at IS DISTINCT FROM OLD.last_used_at
     OR NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
    RAISE EXCEPTION 'worker_only_field' USING ERRCODE = 'P0001';
  END IF;
  -- Deleting is one-way for users: an undelete could race the retention job's purge.
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'media_deleted' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER media_assets_guard BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION app.guard_media_asset();
--> statement-breakpoint

-- Attachments follow their item: locked while the post is in flight or published.
CREATE FUNCTION app.guard_post_item_media() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status post_status;
  row_item uuid;
BEGIN
  IF NOT row_security_active('public.post_item_media') THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  row_item := (coalesce(NEW, OLD)).post_item_id;
  SELECT p.status INTO parent_status
  FROM post_items i JOIN posts p ON p.id = i.post_id
  WHERE i.id = row_item;
  IF parent_status IN ('queued', 'publishing', 'processing', 'published') THEN
    RAISE EXCEPTION 'post_locked' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.post_item_id IS DISTINCT FROM OLD.post_item_id THEN
    RAISE EXCEPTION 'worker_only_field' USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER post_item_media_guard BEFORE INSERT OR UPDATE OR DELETE ON post_item_media
  FOR EACH ROW EXECUTE FUNCTION app.guard_post_item_media();
--> statement-breakpoint

-- Step 2 of an upload (ADR-015): reserve a row before the browser gets its presigned PUT.
-- Editors only. The key must sit under ws/{workspace}/{media}/ so a tenant can be purged by
-- prefix. Uploads still in flight from the last 24 h count against the quota, so many
-- parallel reservations cannot overshoot it; the workspace row lock serialises them.
CREATE FUNCTION app.reserve_media(
  p_workspace_id uuid,
  p_media_id uuid,
  p_filename text,
  p_mime text,
  p_bytes bigint,
  p_retention media_retention,
  p_storage_key text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid uuid := app.current_user_id();
  used bigint;
  in_flight bigint;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT app.has_role(p_workspace_id, 'editor') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_storage_key NOT LIKE 'ws/' || p_workspace_id || '/' || p_media_id || '/%'
     OR p_storage_key !~ '/original\.[a-z0-9]{1,8}$' THEN
    RAISE EXCEPTION 'invalid_key' USING ERRCODE = 'P0001';
  END IF;

  SELECT storage_bytes_used INTO used FROM workspaces WHERE id = p_workspace_id FOR UPDATE;
  SELECT coalesce(sum(bytes), 0) INTO in_flight FROM media_assets
  WHERE workspace_id = p_workspace_id AND status = 'uploading'
    AND created_at > now() - interval '24 hours';
  IF used + in_flight + p_bytes > app.storage_quota_bytes() THEN
    RAISE EXCEPTION 'quota_exceeded' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO media_assets
    (id, workspace_id, created_by, filename, mime, bytes, storage_key, status, retention)
  VALUES
    (p_media_id, p_workspace_id, uid, p_filename, p_mime, p_bytes, p_storage_key, 'uploading',
     p_retention);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.reserve_media(uuid, uuid, text, text, bigint, media_retention, text)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.reserve_media(uuid, uuid, text, text, bigint, media_retention, text)
  TO qs_web;
--> statement-breakpoint

-- Step 4: the browser says the PUT finished and the server has HEADed the object. The stored
-- size must match what was reserved (the presigned URL is bound to it, so a mismatch means
-- tampering). Moves the row to processing for media.probe and charges the workspace quota.
CREATE FUNCTION app.confirm_media(p_media_id uuid, p_stored_bytes bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m media_assets%ROWTYPE;
BEGIN
  SELECT * INTO m FROM media_assets WHERE id = p_media_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT app.has_role(m.workspace_id, 'viewer') THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT app.has_role(m.workspace_id, 'editor') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF m.status <> 'uploading' THEN
    RAISE EXCEPTION 'not_uploading' USING ERRCODE = 'P0001';
  END IF;
  IF p_stored_bytes IS DISTINCT FROM m.bytes THEN
    RAISE EXCEPTION 'size_mismatch' USING ERRCODE = 'P0001';
  END IF;
  UPDATE media_assets SET status = 'processing' WHERE id = m.id;
  UPDATE workspaces SET storage_bytes_used = storage_bytes_used + m.bytes
  WHERE id = m.workspace_id;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.confirm_media(uuid, bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.confirm_media(uuid, bigint) TO qs_web;
--> statement-breakpoint

-- Row-level security. Viewers see the library; editors rename, re-file and delete media and
-- attach it to posts. No INSERT or DELETE policy on media_assets: see the functions above.
REVOKE INSERT, DELETE ON media_assets FROM qs_web;
--> statement-breakpoint
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY media_assets_read ON media_assets FOR SELECT
  USING (app.has_role(workspace_id, 'viewer'));
--> statement-breakpoint
CREATE POLICY media_assets_update ON media_assets FOR UPDATE
  USING (app.has_role(workspace_id, 'editor')) WITH CHECK (app.has_role(workspace_id, 'editor'));
--> statement-breakpoint

ALTER TABLE post_item_media ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY post_item_media_read ON post_item_media FOR SELECT
  USING (app.has_role(workspace_id, 'viewer'));
--> statement-breakpoint
CREATE POLICY post_item_media_write ON post_item_media FOR ALL
  USING (app.has_role(workspace_id, 'editor')) WITH CHECK (app.has_role(workspace_id, 'editor'));
