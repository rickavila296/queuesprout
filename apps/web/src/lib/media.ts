import 'server-only';
import { getMediaByIds, listMedia, type MediaSummary } from '@queuesprout/db';
import type { Tx } from '@queuesprout/db';
import { presignGet } from '@queuesprout/storage';
import { storage } from './storage';

/** A library file as the composer shows it. */
export interface ComposerMedia {
  id: string;
  filename: string;
  status: MediaSummary['status'];
  width: number | null;
  height: number | null;
  /** Presigned thumbnail (or original) URL; null while there is nothing to show. */
  previewUrl: string | null;
}

/**
 * Files the composer can attach: the newest uploads that finished, plus whatever the
 * post being edited already uses (attachedIds), so its tray can show them.
 */
export async function loadComposerMedia(
  tx: Tx,
  workspaceId: string,
  attachedIds: string[] = [],
): Promise<ComposerMedia[]> {
  const recent = (await listMedia(tx, workspaceId)).filter(
    (m) => m.status === 'ready' || m.status === 'processing',
  );
  const missing = attachedIds.filter((id) => !recent.some((m) => m.id === id));
  const all = [...recent, ...(await getMediaByIds(tx, workspaceId, missing))];
  const bucket = storage();
  return Promise.all(
    all.map(async (m) => ({
      id: m.id,
      filename: m.filename,
      status: m.status,
      width: m.width,
      height: m.height,
      previewUrl:
        bucket && (m.status === 'ready' || m.status === 'processing')
          ? await presignGet(bucket, m.thumbnailKey ?? m.storageKey)
          : null,
    })),
  );
}
