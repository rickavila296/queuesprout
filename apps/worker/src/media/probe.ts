import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import {
  MAX_IMAGE_EDGE_PX,
  MAX_IMAGE_PIXELS,
  sniffImageType,
  THUMBNAIL_EDGE_PX,
} from '@queuesprout/core/media';
import type { Database } from '@queuesprout/db';
import {
  deferMediaProbe,
  listMediaToProbe,
  markMediaFailed,
  markMediaReady,
  type MediaToProbe,
} from '@queuesprout/db/media-processing';
import { MAX_IMAGE_BYTES } from '@queuesprout/shared';
import { getObjectBytes, putObject, variantKey, type Storage } from '@queuesprout/storage';

export interface ProbeDeps {
  db: Database;
  storage: Storage;
  log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void };
}

/** Files checked per tick; each is at most 20 MB, so this bounds the tick's memory. */
const BATCH = 5;

type Outcome = 'ready' | 'failed' | 'deferred';

/** A user-facing reason the file was refused. Anything else is treated as transient. */
class RejectedFile extends Error {}

async function probeOne(deps: ProbeDeps, media: MediaToProbe): Promise<Outcome> {
  const bytes = await getObjectBytes(deps.storage, media.storageKey, MAX_IMAGE_BYTES);
  if (!bytes) throw new RejectedFile('The file is missing from storage. Upload it again.');

  const type = sniffImageType(bytes.subarray(0, 16));
  if (!type) throw new RejectedFile('This is not a JPEG, PNG, WebP or GIF image.');
  if (type !== media.mime) {
    throw new RejectedFile('The file content does not match its type. Export it again and upload.');
  }

  let meta: Metadata;
  try {
    meta = await sharp(bytes, {
      animated: true,
      // metadata() reads the header only; the size checks below come before any decode.
      limitInputPixels: false,
    }).metadata();
  } catch {
    throw new RejectedFile('The image could not be read. It may be damaged.');
  }
  // For animated images sharp reports the whole strip; pageHeight is one frame.
  const width = meta.width;
  const height = meta.pageHeight ?? meta.height;
  if (!width || !height) throw new RejectedFile('The image could not be read. It may be damaged.');
  if (width > MAX_IMAGE_EDGE_PX || height > MAX_IMAGE_EDGE_PX) {
    throw new RejectedFile(`Images can be up to ${MAX_IMAGE_EDGE_PX} pixels on each side.`);
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new RejectedFile(`Images can be up to ${MAX_IMAGE_PIXELS / 1_000_000} megapixels.`);
  }

  // First frame only, EXIF orientation applied, metadata (GPS and the like) dropped.
  let thumbnail: Buffer;
  try {
    thumbnail = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize(THUMBNAIL_EDGE_PX, THUMBNAIL_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    // The header parsed but the pixel data did not, e.g. a truncated upload.
    throw new RejectedFile('The image could not be read. It may be damaged.');
  }
  const thumbnailKey = variantKey(media.workspaceId, media.id, 'thumb', 'webp');
  await putObject(deps.storage, thumbnailKey, thumbnail, 'image/webp');

  const done = await markMediaReady(deps.db, media.id, {
    mime: type,
    width,
    height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    thumbnailKey,
  });
  return done ? 'ready' : 'deferred';
}

/**
 * One media.probe tick (upload step 5): checks each confirmed upload's real type from its
 * magic bytes, reads its dimensions, writes a thumbnail and marks it ready. Refused files
 * are marked failed with a reason; storage or network errors leave the file for a later tick.
 */
export async function probeMediaOnce(deps: ProbeDeps): Promise<Record<Outcome, number>> {
  const summary: Record<Outcome, number> = { ready: 0, failed: 0, deferred: 0 };
  for (const media of await listMediaToProbe(deps.db, BATCH)) {
    try {
      summary[await probeOne(deps, media)]++;
    } catch (error) {
      if (error instanceof RejectedFile) {
        await markMediaFailed(deps.db, media.id, error.message);
        deps.log.info({ mediaId: media.id, reason: error.message }, 'media refused');
        summary.failed++;
      } else {
        await deferMediaProbe(deps.db, media.id);
        deps.log.warn({ err: error, mediaId: media.id }, 'media probe failed, will retry');
        summary.deferred++;
      }
    }
  }
  return summary;
}
