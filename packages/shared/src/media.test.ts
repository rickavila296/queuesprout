import { describe, expect, it } from 'vitest';
import { createUploadSchema, formatBytes, MAX_IMAGE_BYTES } from './media';

describe('createUploadSchema', () => {
  const base = { filename: 'cat.png', mime: 'image/png', bytes: 1024 };

  it.each([
    ['a PNG', base, true],
    ['a JPEG at the size cap', { ...base, mime: 'image/jpeg', bytes: MAX_IMAGE_BYTES }, true],
    ['a file over the cap', { ...base, bytes: MAX_IMAGE_BYTES + 1 }, false],
    ['an empty file', { ...base, bytes: 0 }, false],
    ['an SVG (scriptable)', { ...base, mime: 'image/svg+xml' }, false],
    ['HTML', { ...base, mime: 'text/html' }, false],
    ['a video (Phase 3)', { ...base, mime: 'video/mp4' }, false],
    ['a blank name', { ...base, filename: '   ' }, false],
  ])('%s', (_label, input, valid) => {
    expect(createUploadSchema.safeParse(input).success).toBe(valid);
  });

  it('defaults to auto retention and trims long names', () => {
    const parsed = createUploadSchema.parse({ ...base, filename: `${'a'.repeat(300)}.png` });
    expect(parsed.retention).toBe('auto');
    expect(parsed.filename).toHaveLength(200);
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('%d -> %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
