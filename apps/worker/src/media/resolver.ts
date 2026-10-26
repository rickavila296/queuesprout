import sharp, { type Sharp } from 'sharp';
import { MAX_IMAGE_PIXELS } from '@queuesprout/core/media';
import type { Database } from '@queuesprout/db';
import { getMediaForPublish } from '@queuesprout/db/media-processing';
import type {
  MediaFile,
  MediaFileResult,
  MediaFileSpec,
  MediaResolver,
} from '@queuesprout/providers';
import { MAX_IMAGE_BYTES } from '@queuesprout/shared';
import { getObjectBytes, presignGet, type Storage } from '@queuesprout/storage';

const ENCODERS = {
  'image/jpeg': (img: Sharp, quality: number) =>
    img.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }),
  'image/png': (img: Sharp) => img.png({ compressionLevel: 9 }),
  'image/webp': (img: Sharp, quality: number) => img.webp({ quality }),
} as const;
type Encodable = keyof typeof ENCODERS;
const isEncodable = (mime: string): mime is Encodable => mime in ENCODERS;

/** Quality steps tried, best first, before the image is scaled down further. */
const QUALITIES = [90, 80, 70, 60, 50] as const;

/**
 * Fits an image to a platform's spec: upright (EXIF orientation applied), at most
 * maxEdgePx on the long side, in an accepted type and under maxBytes. Every output is
 * re-encoded, so metadata such as GPS never leaves QueueSprout. GIFs keep their first frame.
 * The source type is kept when accepted (PNG keeps transparency); when it is not, or a PNG
 * will not fit, JPEG is used, scaling down until it fits. Null when nothing fits.
 */
export async function fitImage(source: Uint8Array, spec: MediaFileSpec): Promise<MediaFile | null> {
  const meta = await sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  const sourceMime = `image/${meta.format}`;
  const accepted = (mime: string): mime is Encodable =>
    isEncodable(mime) && spec.mimeTypes.includes(mime);
  const candidates = [...new Set([sourceMime, 'image/jpeg', ...spec.mimeTypes].filter(accepted))];
  if (candidates.length === 0) return null;

  const longest = Math.max(meta.width ?? 0, meta.pageHeight ?? meta.height ?? 0);
  const startEdge = Math.min(longest, spec.maxEdgePx ?? longest);
  const encode = async (target: Encodable, edge: number, quality: number) => {
    const { data, info } = await ENCODERS[target](
      sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS })
        .rotate()
        .resize(edge, edge, { fit: 'inside', withoutEnlargement: true }),
      quality,
    ).toBuffer({ resolveWithObject: true });
    return data.byteLength <= spec.maxBytes
      ? { bytes: new Uint8Array(data), mime: target, width: info.width, height: info.height }
      : null;
  };

  // Lossless PNG gets one try at full size; lossy types step down quality, then size.
  for (const target of candidates) {
    if (target === 'image/png') {
      const fitted = await encode(target, startEdge, 100);
      if (fitted) return fitted;
      continue;
    }
    // Six rounds take the edge down to about a fifth; tiny images get a single round.
    for (let edge = startEdge, round = 0; round < 6; round++) {
      for (const quality of QUALITIES) {
        const fitted = await encode(target, edge, quality);
        if (fitted) return fitted;
      }
      edge = Math.floor(edge * 0.75);
      if (edge < 64) break;
    }
  }
  return null;
}

/** The MediaResolver a publish step hands its adapter, scoped to the post's workspace. */
export function createMediaResolver(deps: {
  db: Database;
  storage: Storage | null;
  workspaceId: string;
}): MediaResolver {
  const unusable = (message: string): MediaFileResult => ({ ok: false, retryable: false, message });

  async function load(mediaId: string) {
    const media = await getMediaForPublish(deps.db, deps.workspaceId, mediaId);
    if (!media) throw new Error(`Media ${mediaId} not found in this workspace.`);
    return media;
  }

  return {
    async getUrl(mediaId) {
      const media = await load(mediaId);
      if (!deps.storage) throw new Error('Media storage is not configured on the worker.');
      return presignGet(deps.storage, media.storageKey);
    },

    async getInfo(mediaId) {
      const media = await load(mediaId);
      return {
        id: media.id,
        mime: media.mime,
        bytes: media.bytes,
        ...(media.width !== null && { width: media.width }),
        ...(media.height !== null && { height: media.height }),
      };
    },

    async getFile(mediaId, spec) {
      if (!deps.storage) return unusable('Media storage is not configured on the worker.');
      try {
        const media = await getMediaForPublish(deps.db, deps.workspaceId, mediaId);
        if (!media) return unusable('An attached image no longer exists.');
        if (media.status === 'processing' || media.status === 'uploading') {
          return {
            ok: false,
            retryable: true,
            message: 'An attached image is still being checked.',
          };
        }
        if (media.status !== 'ready') {
          return unusable('An attached image is no longer available. Remove it and retry.');
        }
        const bytes = await getObjectBytes(deps.storage, media.storageKey, MAX_IMAGE_BYTES);
        if (!bytes) return unusable('An attached image is missing from storage.');
        const file = await fitImage(bytes, spec);
        return file
          ? { ok: true, file }
          : unusable('An attached image could not be made small enough for this platform.');
      } catch {
        // Storage or database hiccup: the next attempt may well succeed.
        return { ok: false, retryable: true, message: 'Could not load an attached image.' };
      }
    },
  };
}
