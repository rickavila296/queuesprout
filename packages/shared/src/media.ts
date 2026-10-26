import { z } from 'zod';

export const MEDIA_STATUSES = ['uploading', 'processing', 'ready', 'failed', 'purged'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** library: kept until deleted. auto: purged 30 days after its last post is final. */
export const MEDIA_RETENTIONS = ['library', 'auto'] as const;
export type MediaRetention = (typeof MEDIA_RETENTIONS)[number];

/**
 * When the media.retention job removes a file's bytes from storage. Files deleted from
 * the library go at the next run. A file is never
 * removed while a post that may still publish uses it (draft, waiting for approval,
 * scheduled, in flight, or failed within MEDIA_FAILED_POST_HOLD_DAYS, since a failed post
 * can be retried).
 */
export const MEDIA_RETENTION = {
  /** "auto" files: this long after the last post using them is final, or after upload. */
  autoDays: 30,
  /** Files that failed the upload check. */
  failedDays: 7,
  /** Reserved but never uploaded. */
  abandonedUploadHours: 24,
  /** A failed post keeps its files this long for a retry. */
  failedPostHoldDays: 30,
} as const;

/**
 * Upload allowlist and the file extension each type is stored under. Images only in
 * Phase 2; video arrives with transcoding in Phase 3. The worker checks magic bytes
 * before a file is marked ready, so this is only the first gate.
 */
export const IMAGE_MIME_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;
export type ImageMimeType = keyof typeof IMAGE_MIME_TYPES;

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Per-workspace storage cap. Mirrors app.storage_quota_bytes() in the database, which
 * is what enforces it. Sized for the 1 GB free tier with room for a demo workspace.
 */
export const WORKSPACE_STORAGE_QUOTA_BYTES = 500 * 1024 * 1024;

export const MAX_FILENAME_LENGTH = 200;

export const createUploadSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, 'The file needs a name.')
    .transform((name) => name.slice(0, MAX_FILENAME_LENGTH)),
  mime: z.enum(Object.keys(IMAGE_MIME_TYPES) as [ImageMimeType, ...ImageMimeType[]], {
    error: 'Upload a JPEG, PNG, WebP or GIF image.',
  }),
  bytes: z
    .number()
    .int()
    .positive('The file is empty.')
    .max(MAX_IMAGE_BYTES, `Images can be up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`),
  retention: z.enum(MEDIA_RETENTIONS).default('auto'),
});
export type CreateUploadInput = z.input<typeof createUploadSchema>;

export function extensionForMime(mime: ImageMimeType): string {
  return IMAGE_MIME_TYPES[mime];
}

/** "1.2 MB" style sizes for the UI. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
