-- Retrying a failed post from the post page. Users may not touch item statuses (the guard
-- triggers keep publish results worker-only), so this function resets the failed item to
-- pending and reschedules the post for now. Published items stay published, so the worker
-- resumes at the first item that is not out yet and never posts one twice.
-- A post that failed with 'unknown' may already be on the platform: retrying it needs
-- p_confirm_unknown, which the page sets only after the user says they checked.
CREATE FUNCTION app.retry_post(p_post_id uuid, p_confirm_unknown boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p posts%ROWTYPE;
  account_status account_status;
  channel_status channel_status;
BEGIN
  SELECT * INTO p FROM posts WHERE id = p_post_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT app.has_role(p.workspace_id, 'viewer') THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT app.has_role(p.workspace_id, 'editor') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p.status <> 'failed' THEN
    RAISE EXCEPTION 'not_failed' USING ERRCODE = 'P0001';
  END IF;
  IF p.error_kind = 'unknown' AND NOT coalesce(p_confirm_unknown, false) THEN
    RAISE EXCEPTION 'confirm_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT a.status, c.status INTO account_status, channel_status
  FROM channels c JOIN connected_accounts a ON a.id = c.account_id
  WHERE c.id = p.channel_id;
  IF account_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'account_needs_reauth' USING ERRCODE = 'P0001';
  END IF;
  IF channel_status IN ('disabled', 'target_missing') THEN
    RAISE EXCEPTION 'channel_unavailable' USING ERRCODE = 'P0001';
  END IF;

  UPDATE post_items SET status = 'pending', error_message = NULL
  WHERE post_id = p.id AND status = 'failed';
  UPDATE posts SET
    status = 'scheduled',
    scheduled_at = now(),
    error_kind = NULL,
    error_message = NULL,
    attempt_count = 0,
    publish_checkpoint = NULL,
    external_container_id = NULL,
    next_check_at = NULL,
    processing_deadline_at = NULL
  WHERE id = p.id;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.retry_post(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.retry_post(uuid, boolean) TO qs_web;
--> statement-breakpoint

-- A retried post is 'scheduled' again while its first items are already out. Users may
-- reschedule it, but never edit or delete an item that is published: rewriting it would
-- send it a second time. Same function as before, plus that check.
CREATE OR REPLACE FUNCTION app.guard_post_item() RETURNS trigger
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
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'published' THEN
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
