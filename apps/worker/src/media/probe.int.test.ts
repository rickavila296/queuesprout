import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@queuesprout/db';
import { createTestDatabase, type TestDatabase } from '@queuesprout/db/testing';
import {
  createStorage,
  getObjectBytes,
  originalKey,
  putObject,
  type Storage,
} from '@queuesprout/storage';
import { probeMediaOnce } from './probe';

const { mediaAssets, workspaces } = schema;

/** Needs Postgres and an S3-compatible server (SeaweedFS in CI), like the storage tests. */
const endpoint = process.env.TEST_S3_ENDPOINT;

describe.skipIf(!endpoint)('media.probe (real Postgres and S3)', () => {
  let t: TestDatabase;
  let storage: Storage;
  let workspaceId: string;
  const log = { info: () => undefined, warn: () => undefined };

  const solid = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#23804A' } });

  /** Puts the bytes in the bucket and a processing row in the database, as confirm would. */
  async function confirmed(body: Uint8Array | null, mime: string, ext: string) {
    const id = randomUUID();
    const storageKey = originalKey(workspaceId, id, ext);
    if (body) await putObject(storage, storageKey, body, mime);
    await t.owner.insert(mediaAssets).values({
      id,
      workspaceId,
      filename: `file.${ext}`,
      mime,
      bytes: body?.byteLength || 1,
      storageKey,
      status: 'processing',
    });
    return id;
  }

  /** Runs ticks until the queue is empty (each tick takes a batch). */
  async function drain(s: Storage = storage) {
    const total = { ready: 0, failed: 0, deferred: 0 };
    for (let i = 0; i < 10; i++) {
      const tick = await probeMediaOnce({ db: t.owner, storage: s, log });
      total.ready += tick.ready;
      total.failed += tick.failed;
      total.deferred += tick.deferred;
      if (tick.ready + tick.failed === 0) break;
    }
    return total;
  }

  const row = async (id: string) => {
    const [r] = await t.owner.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    if (!r) throw new Error('missing');
    return r;
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    storage = createStorage({
      endpoint: endpoint ?? 'http://localhost:8333',
      bucket: process.env.TEST_S3_BUCKET ?? 'queuesprout-media',
      accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'queuesprout',
      secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'queuesprout-s3-secret',
      forcePathStyle: true,
    });
    const [ws] = await t.owner
      .insert(workspaces)
      .values({ name: 'Acme', slug: `acme-${randomUUID().slice(0, 8)}` })
      .returning();
    if (!ws) throw new Error('no workspace');
    workspaceId = ws.id;
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('marks real images ready with dimensions, hash and a thumbnail', async () => {
    const png = await confirmed(await solid(1200, 800).png().toBuffer(), 'image/png', 'png');
    const jpeg = await confirmed(await solid(300, 500).jpeg().toBuffer(), 'image/jpeg', 'jpg');
    const webp = await confirmed(await solid(64, 64).webp().toBuffer(), 'image/webp', 'webp');
    const gif = await confirmed(await solid(10, 20).gif().toBuffer(), 'image/gif', 'gif');

    expect(await probeMediaOnce({ db: t.owner, storage, log })).toEqual({
      ready: 4,
      failed: 0,
      deferred: 0,
    });

    const p = await row(png);
    expect([p.status, p.width, p.height, p.mime]).toEqual(['ready', 1200, 800, 'image/png']);
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.thumbnailKey).toBe(`ws/${workspaceId}/${png}/thumb.webp`);
    const thumb = await getObjectBytes(storage, p.thumbnailKey ?? '', 1_000_000);
    const thumbMeta = await sharp(thumb ?? new Uint8Array()).metadata();
    expect([thumbMeta.format, thumbMeta.width, thumbMeta.height]).toEqual(['webp', 400, 267]);

    expect([(await row(jpeg)).width, (await row(jpeg)).height]).toEqual([300, 500]);
    expect((await row(webp)).status).toBe('ready');
    expect((await row(gif)).height).toBe(20);
    // Small images are not blown up for the thumbnail.
    const webpThumb = await getObjectBytes(storage, (await row(webp)).thumbnailKey ?? '', 1e6);
    expect((await sharp(webpThumb ?? new Uint8Array()).metadata()).width).toBe(64);
  });

  it('refuses files that are not what they claim, with a reason', async () => {
    const svg = await confirmed(
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      'image/png',
      'png',
    );
    const mismatch = await confirmed(await solid(10, 10).png().toBuffer(), 'image/jpeg', 'jpg');
    const missing = await confirmed(null, 'image/png', 'png');
    const damaged = await confirmed(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
      'image/png',
      'png',
    );
    const huge = await confirmed(await solid(12_500, 10).png().toBuffer(), 'image/png', 'png');
    const megapixels = await confirmed(
      await solid(10_000, 6_000).png({ compressionLevel: 9 }).toBuffer(),
      'image/png',
      'png',
    );
    const pngBytes = await solid(200, 200).png().toBuffer();
    const truncated = await confirmed(pngBytes.subarray(0, 120), 'image/png', 'png');

    expect(await drain()).toEqual({
      ready: 0,
      failed: 7,
      deferred: 0,
    });
    expect((await row(svg)).errorMessage).toMatch(/not a JPEG, PNG, WebP or GIF/);
    expect((await row(mismatch)).errorMessage).toMatch(/does not match its type/);
    expect((await row(missing)).errorMessage).toMatch(/missing from storage/);
    expect((await row(damaged)).errorMessage).toMatch(/could not be read/);
    expect((await row(huge)).errorMessage).toMatch(/12000 pixels/);
    expect((await row(megapixels)).errorMessage).toMatch(/50 megapixels/);
    expect((await row(truncated)).errorMessage).toMatch(/could not be read/);
    for (const id of [svg, mismatch, missing, damaged, huge, megapixels, truncated]) {
      expect((await row(id)).status).toBe('failed');
    }
  });

  it('leaves files for a later tick when storage is unreachable', async () => {
    const id = await confirmed(await solid(10, 10).png().toBuffer(), 'image/png', 'png');
    const down = createStorage({
      endpoint: 'http://127.0.0.1:1',
      bucket: 'queuesprout-media',
      accessKeyId: 'x',
      secretAccessKey: 'y',
      forcePathStyle: true,
    });
    const summary = await probeMediaOnce({ db: t.owner, storage: down, log });
    expect(summary.deferred).toBeGreaterThanOrEqual(1);
    expect((await row(id)).status).toBe('processing');

    await probeMediaOnce({ db: t.owner, storage, log });
    expect((await row(id)).status).toBe('ready');
  });

  it('skips deleted uploads', async () => {
    const id = await confirmed(await solid(10, 10).png().toBuffer(), 'image/png', 'png');
    await t.owner.update(mediaAssets).set({ deletedAt: new Date() }).where(eq(mediaAssets.id, id));
    await probeMediaOnce({ db: t.owner, storage, log });
    expect((await row(id)).status).toBe('processing');
  });
});
