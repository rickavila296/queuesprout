import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { fitImage } from './resolver';

const BLUESKY = {
  maxBytes: 1_000_000,
  maxEdgePx: 2000,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
};

/** Random pixels compress badly, so these images are large in bytes. */
function noise(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width, height, channels: 3 } });
}

const solid = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 4, background: { r: 35, g: 128, b: 74, alpha: 0.5 } },
  });

describe('fitImage', () => {
  it('keeps a small accepted PNG as PNG with its transparency', async () => {
    const out = await fitImage(await solid(300, 200).png().toBuffer(), BLUESKY);
    expect(out).toMatchObject({ mime: 'image/png', width: 300, height: 200 });
    const meta = await sharp(out?.bytes).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it('scales the long edge down to the platform limit', async () => {
    const out = await fitImage(await solid(4000, 1000).jpeg().toBuffer(), BLUESKY);
    expect(out).toMatchObject({ mime: 'image/jpeg', width: 2000, height: 500 });
  });

  it('turns a PNG that will not fit into a JPEG under maxBytes', async () => {
    // Small enough to stay fast on a busy machine; the cap forces the PNG out.
    const spec = { ...BLUESKY, maxBytes: 150_000 };
    const png = await noise(500, 400).png().toBuffer();
    expect(png.byteLength).toBeGreaterThan(spec.maxBytes);
    const out = await fitImage(png, spec);
    expect(out?.mime).toBe('image/jpeg');
    expect(out?.bytes.byteLength).toBeLessThanOrEqual(spec.maxBytes);
  });

  it('converts a type the platform does not take, keeping the first GIF frame', async () => {
    const out = await fitImage(await solid(40, 30).gif().toBuffer(), BLUESKY);
    expect(out).toMatchObject({ mime: 'image/jpeg', width: 40, height: 30 });
  });

  it('strips metadata such as GPS and applies the EXIF orientation', async () => {
    const tagged = await solid(60, 20)
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD3: { GPSLatitudeRef: 'N' } } })
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();

    const out = await fitImage(tagged, BLUESKY);
    const meta = await sharp(out?.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    // Rotated upright: orientation 6 is a quarter turn.
    expect([out?.width, out?.height]).toEqual([20, 60]);
  });

  it('returns null when no accepted type can be produced or nothing fits', async () => {
    const jpeg = await solid(50, 50).jpeg().toBuffer();
    expect(await fitImage(jpeg, { maxBytes: 1e6, mimeTypes: ['image/heic'] })).toBeNull();
    expect(await fitImage(jpeg, { maxBytes: 10, mimeTypes: ['image/jpeg'] })).toBeNull();
  });
});
