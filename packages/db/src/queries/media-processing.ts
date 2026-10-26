import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { ImageMimeType } from '@queuesprout/shared';
import type { Database } from '../client';
import { mediaAssets } from '../schema/media';

/** Worker-only: media.probe reads uploads waiting to be checked and records the result. */

export interface MediaToProbe {
  id: string;
  workspaceId: string;
  storageKey: string;
  mime: string;
  bytes: number;
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
