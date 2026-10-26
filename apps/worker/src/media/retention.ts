import type { Database } from '@queuesprout/db';
import {
  listMediaToRemove,
  markMediaPurged,
  markMediaRemoved,
} from '@queuesprout/db/media-processing';
import { deleteObject, variantKey, type Storage } from '@queuesprout/storage';

export interface RetentionDeps {
  db: Database;
  storage: Storage;
  now: () => Date;
  log: { warn(obj: object, msg: string): void };
}

/** Files marked and removed per run; the next run continues where this one stopped. */
const BATCH = 100;

export interface RetentionSummary {
  /** Files that became purged (their quota is given back). */
  purged: number;
  /** Purged files whose objects were removed from the bucket. */
  removed: number;
  /** Purged files whose objects could not be removed yet; retried next run. */
  errors: number;
}

/**
 * media.retention: marks files nothing needs any more as purged (policy in
 * MEDIA_RETENTION), then removes their objects. A file whose removal fails stays purged
 * without purged_at and is retried next run, so the bucket never keeps stray objects.
 */
export async function runMediaRetention(deps: RetentionDeps): Promise<RetentionSummary> {
  const purged = await markMediaPurged(deps.db, deps.now(), BATCH);
  let removed = 0;
  let errors = 0;
  for (const target of await listMediaToRemove(deps.db, BATCH)) {
    try {
      // The thumbnail key is fixed, and a check that was running when the file was deleted
      // can write it after the row lost its thumbnail_key, so remove it either way.
      const thumb = variantKey(target.workspaceId, target.id, 'thumb', 'webp');
      for (const key of new Set([...target.keys, thumb])) await deleteObject(deps.storage, key);
      await markMediaRemoved(deps.db, target.id, deps.now());
      removed++;
    } catch (error) {
      errors++;
      deps.log.warn({ err: error, mediaId: target.id }, 'could not remove purged media objects');
    }
  }
  return { purged, removed, errors };
}
