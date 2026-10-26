import type { ImageMimeType } from '@queuesprout/shared';

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0) =>
  bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * The image type a file really is, from its first bytes. Never trust the browser's
 * Content-Type: a renamed HTML or SVG file must not be served back as an image.
 * Returns null for anything outside the upload allowlist.
 */
export function sniffImageType(head: Uint8Array): ImageMimeType | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

/** Longest edge of the preview the media library and composer show. */
export const THUMBNAIL_EDGE_PX = 400;

/** Larger images are refused: platforms cap far lower, and decoding them is a memory risk. */
export const MAX_IMAGE_EDGE_PX = 12_000;

/** Decoding is width × height × 4 bytes of memory, so total pixels are capped too (~200 MB). */
export const MAX_IMAGE_PIXELS = 50_000_000;
