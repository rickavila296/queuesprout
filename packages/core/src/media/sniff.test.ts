import { describe, expect, it } from 'vitest';
import { sniffImageType } from './sniff';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe('sniffImageType', () => {
  it.each([
    ['JPEG', bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'image/jpeg'],
    ['PNG', bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), 'image/png'],
    ['GIF89a', bytes('GIF89a', [1, 0]), 'image/gif'],
    ['GIF87a', bytes('GIF87a'), 'image/gif'],
    ['WebP', bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '), 'image/webp'],
    ['a RIFF that is not WebP (WAV)', bytes('RIFF', [0x24, 0, 0, 0], 'WAVEfmt '), null],
    ['SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg">'), null],
    ['HTML', bytes('<!doctype html><script>'), null],
    ['a truncated PNG signature', bytes([0x89], 'PN'), null],
    ['nothing', bytes(), null],
  ])('%s', (_label, head, type) => {
    expect(sniffImageType(head)).toBe(type);
  });
});
