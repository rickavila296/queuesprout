ALTER TABLE "posts" ADD COLUMN "failure_notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "posts_unnotified_failures_idx" ON "posts" USING btree ("updated_at") WHERE "posts"."status" = 'failed' and "posts"."failure_notified_at" is null;--> statement-breakpoint
-- Posts that failed before failure emails existed are not announced now.
UPDATE posts SET failure_notified_at = now() WHERE status = 'failed';
--> statement-breakpoint
-- Same as 0008, plus clearing failure_notified_at so a retry that fails again is emailed.
CREATE OR REPLACE FUNCTION app.retry_post(p_post_id uuid, p_confirm_unknown boolean)
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
    processing_deadline_at = NULL,
    failure_notified_at = NULL
  WHERE id = p.id;
END
$$;
