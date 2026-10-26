import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { MEDIA_RETENTION, type ImageMimeType, type MediaStatus } from '@queuesprout/shared';
import type { Database } from '../client';
import { mediaAssets } from '../schema/media';

/** Worker-only: media.probe reads uploads waiting to be checked and records the result. */

export interface MediaToProbe {
  id: string;
  workspaceId: string;
  storageKey: string;
  mime: string;
  bytes: number;
  createdAt: Date;
}

/** Oldest first. Deleted files are skipped; the retention job removes them. */
export function listMediaToProbe(db: Database, limit: number): Promise<MediaToProbe[]> {
  return db
    .select({
      id: mediaAssets.id,
      workspaceId: mediaAssets.workspaceId,
      storageKey: mediaAssets.storageKey,
      mime: mediaAssets.mime,
      bytes: mediaAssets.bytes,
      createdAt: mediaAssets.createdAt,
    })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.status, 'processing'), isNull(mediaAssets.deletedAt)))
    .orderBy(asc(mediaAssets.updatedAt))
    .limit(limit);
}

export interface ProbedImage {
  mime: ImageMimeType;
  width: number;
  height: number;
  sha256: string;
  thumbnailKey: string;
}

/** Only from processing, so a second worker or a late retry cannot overwrite a result. */
export async function markMediaReady(
  db: Database,
  mediaId: string,
  probed: ProbedImage,
): Promise<boolean> {
  const rows = await db
    .update(mediaAssets)
    .set({ status: 'ready', errorMessage: null, ...probed })
    .where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.status, 'processing')))
    .returning({ id: mediaAssets.id });
  return rows.length > 0;
}

export async function markMediaFailed(
  db: Database,
  mediaId: string,
  message: string,
): Promise<boolean> {
  const rows = await db
    .update(mediaAssets)
    .set({ status: 'failed', errorMessage: message })
    .where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.status, 'processing')))
    .returning({ id: mediaAssets.id });
  return rows.length > 0;
}

/** Moves a file that hit a transient error to the back of the queue. */
export async function deferMediaProbe(db: Database, mediaId: string): Promise<void> {
  await db
    .update(mediaAssets)
    .set({ updatedAt: sql`now()` })
    .where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.status, 'processing')));
}

export interface MediaForPublish {
  id: string;
  storageKey: string;
  status: MediaStatus;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

/**
 * A file a publish step attaches, scoped to the post's workspace. Soft-deleted files still
 * resolve: deleting from the library must not break a post that was already scheduled.
 */
export async function getMediaForPublish(
  db: Database,
  workspaceId: string,
  mediaId: string,
): Promise<MediaForPublish | null> {
  const [row] = await db
    .select({
      id: mediaAssets.id,
      storageKey: mediaAssets.storageKey,
      status: mediaAssets.status,
      mime: mediaAssets.mime,
      bytes: mediaAssets.bytes,
      width: mediaAssets.width,
      height: mediaAssets.height,
    })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.workspaceId, workspaceId), eq(mediaAssets.id, mediaId)))
    .limit(1);
  return row ?? null;
}

/** Worker-only: media.retention removes files nothing needs any more. */

export interface PurgeTarget {
  id: string;
  workspaceId: string;
  /** Every object the file has: the original, its thumbnail and platform variants. */
  keys: string[];
}

/**
 * Marks up to `limit` files as purged and gives their bytes back to the workspace quota,
 * in one statement. A file qualifies when no post that may still publish uses it and it
 * is deleted from the library, failed its check a week ago, was never uploaded, or is an
 * "auto" file whose last post went final 30 days ago (MEDIA_RETENTION). Marking comes
 * before removing the objects, so a post can no longer attach a file being removed;
 * purged_at stays null until removeMediaObjects confirms the objects are gone.
 */
export async function markMediaPurged(db: Database, now: Date, limit: number): Promise<number> {
  const r = MEDIA_RETENTION;
  const at = now.toISOString();
  const result = await db.execute(sql`
    WITH picked AS (
      SELECT m.id, m.status AS old_status
      FROM media_assets m
      WHERE m.status <> 'purged'
        AND NOT app.media_needed_by_post(m.id, ${at}::timestamptz, ${r.failedPostHoldDays})
        AND (
          (m.status = 'uploading'
            AND m.created_at < ${at}::timestamptz - make_interval(hours => ${r.abandonedUploadHours}))
          OR (m.status <> 'uploading' AND m.deleted_at IS NOT NULL)
          OR (m.status = 'failed'
            AND m.updated_at < ${at}::timestamptz - make_interval(days => ${r.failedDays}))
          OR (m.status IN ('ready', 'processing', 'failed') AND m.retention = 'auto'
            AND greatest(m.created_at, (
              SELECT max(p.updated_at) FROM post_item_media pim
              JOIN post_items pi ON pi.id = pim.post_item_id
              JOIN posts p ON p.id = pi.post_id
              WHERE pim.media_id = m.id
            )) < ${at}::timestamptz - make_interval(days => ${r.autoDays}))
        )
      ORDER BY m.created_at
      LIMIT ${limit}
      FOR UPDATE OF m SKIP LOCKED
    ),
    marked AS (
      UPDATE media_assets m SET status = 'purged'
      FROM picked
      WHERE m.id = picked.id
      RETURNING m.workspace_id, m.bytes, picked.old_status
    ),
    released AS (
      -- Only confirmed uploads were charged (app.confirm_media).
      UPDATE workspaces w
      SET storage_bytes_used = greatest(0, w.storage_bytes_used - charged.total)
      FROM (
        SELECT workspace_id, sum(bytes)::bigint AS total FROM marked
        WHERE old_status IN ('processing', 'ready', 'failed')
        GROUP BY workspace_id
      ) charged
      WHERE w.id = charged.workspace_id
    )
    SELECT count(*)::int AS n FROM marked
  `);
  const row = result.rows[0] as { n?: number } | undefined;
  return row?.n ?? 0;
}

/** Purged files whose objects still have to be removed, oldest first. */
export async function listMediaToRemove(db: Database, limit: number): Promise<PurgeTarget[]> {
  const rows = await db
    .select({
      id: mediaAssets.id,
      workspaceId: mediaAssets.workspaceId,
      storageKey: mediaAssets.storageKey,
      thumbnailKey: mediaAssets.thumbnailKey,
      variants: mediaAssets.variants,
    })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.status, 'purged'), isNull(mediaAssets.purgedAt)))
    .orderBy(asc(mediaAssets.updatedAt))
    .limit(limit);
  return rows.map((m) => ({
    id: m.id,
    workspaceId: m.workspaceId,
    keys: [m.storageKey, ...(m.thumbnailKey ? [m.thumbnailKey] : []), ...Object.values(m.variants)],
  }));
}

/** Records that a purged file's objects are gone. The row stays for post history. */
export async function markMediaRemoved(db: Database, mediaId: string, now: Date): Promise<void> {
  await db
    .update(mediaAssets)
    .set({ purgedAt: now, thumbnailKey: null, variants: {} })
    .where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.status, 'purged')));
}
