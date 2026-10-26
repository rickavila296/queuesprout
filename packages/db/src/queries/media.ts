import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { MediaRetention, MediaStatus } from '@queuesprout/shared';
import type { Tx } from '../client';
import { findPgError, PG_INSUFFICIENT_PRIVILEGE } from '../errors';
import { mediaAssets } from '../schema/media';
import { workspaces } from '../schema/workspaces';

/**
 * Media library and upload queries for apps/web. Run them inside withWorkspace(): RLS
 * checks the role, and the guard trigger keeps users off what the worker writes.
 */

export interface ReserveMediaInput {
  workspaceId: string;
  mediaId: string;
  filename: string;
  mime: string;
  bytes: number;
  retention: MediaRetention;
  storageKey: string;
}

export type ReserveMediaError = 'forbidden' | 'quota_exceeded' | 'invalid_key';
export type ConfirmMediaError = 'not_found' | 'forbidden' | 'not_uploading' | 'size_mismatch';

async function callGuarded<E extends string>(
  tx: Tx,
  query: ReturnType<typeof sql>,
  known: ReadonlySet<string>,
): Promise<{ ok: true } | { ok: false; error: E | 'forbidden' }> {
  try {
    // A savepoint, so a refusal leaves the caller's transaction usable.
    await tx.transaction((sp) => sp.execute(query));
    return { ok: true };
  } catch (error) {
    const pg = findPgError(error);
    if (pg?.code === PG_INSUFFICIENT_PRIVILEGE) return { ok: false, error: 'forbidden' };
    if (pg && known.has(pg.message)) return { ok: false, error: pg.message as E };
    throw error;
  }
}

/** Upload step 2: a row in uploading state, within the workspace quota (app.reserve_media). */
export function reserveMedia(tx: Tx, input: ReserveMediaInput) {
  return callGuarded<ReserveMediaError>(
    tx,
    sql`select app.reserve_media(${input.workspaceId}::uuid, ${input.mediaId}::uuid,
      ${input.filename}, ${input.mime}, ${input.bytes}::bigint,
      ${input.retention}::media_retention, ${input.storageKey})`,
    new Set(['quota_exceeded', 'invalid_key']),
  );
}

/** Upload step 4: the object is in the bucket at the reserved size (app.confirm_media). */
export function confirmMedia(tx: Tx, mediaId: string, storedBytes: number) {
  return callGuarded<ConfirmMediaError>(
    tx,
    sql`select app.confirm_media(${mediaId}::uuid, ${storedBytes}::bigint)`,
    new Set(['not_found', 'not_uploading', 'size_mismatch']),
  );
}

export interface MediaSummary {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  storageKey: string;
  status: MediaStatus;
  retention: MediaRetention;
  width: number | null;
  height: number | null;
  thumbnailKey: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

const summaryColumns = {
  id: mediaAssets.id,
  filename: mediaAssets.filename,
  mime: mediaAssets.mime,
  bytes: mediaAssets.bytes,
  storageKey: mediaAssets.storageKey,
  status: mediaAssets.status,
  retention: mediaAssets.retention,
  width: mediaAssets.width,
  height: mediaAssets.height,
  thumbnailKey: mediaAssets.thumbnailKey,
  errorMessage: mediaAssets.errorMessage,
  createdAt: mediaAssets.createdAt,
};

export async function getMedia(
  tx: Tx,
  workspaceId: string,
  mediaId: string,
): Promise<MediaSummary | null> {
  const [row] = await tx
    .select(summaryColumns)
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.workspaceId, workspaceId),
        eq(mediaAssets.id, mediaId),
        isNull(mediaAssets.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Several files by id (attachments of a post being edited). Deleted files are left out. */
export function getMediaByIds(
  tx: Tx,
  workspaceId: string,
  mediaIds: string[],
): Promise<MediaSummary[]> {
  if (mediaIds.length === 0) return Promise.resolve([]);
  return tx
    .select(summaryColumns)
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.workspaceId, workspaceId),
        inArray(mediaAssets.id, mediaIds),
        isNull(mediaAssets.deletedAt),
      ),
    );
}

export const MEDIA_LIBRARY_PAGE_SIZE = 60;

/** Newest first. Purged files stay listed so post history can still show what went out. */
export function listMedia(tx: Tx, workspaceId: string): Promise<MediaSummary[]> {
  return tx
    .select(summaryColumns)
    .from(mediaAssets)
    .where(and(eq(mediaAssets.workspaceId, workspaceId), isNull(mediaAssets.deletedAt)))
    .orderBy(desc(mediaAssets.createdAt))
    .limit(MEDIA_LIBRARY_PAGE_SIZE);
}

/** Soft delete; the retention job removes the files once no active post uses them. */
export async function deleteMedia(tx: Tx, workspaceId: string, mediaId: string): Promise<boolean> {
  const rows = await tx
    .update(mediaAssets)
    .set({ deletedAt: sql`now()` })
    .where(
      and(
        eq(mediaAssets.workspaceId, workspaceId),
        eq(mediaAssets.id, mediaId),
        isNull(mediaAssets.deletedAt),
      ),
    )
    .returning({ id: mediaAssets.id });
  return rows.length > 0;
}

export async function getStorageUsage(tx: Tx, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ used: workspaces.storageBytesUsed })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return row?.used ?? 0;
}
