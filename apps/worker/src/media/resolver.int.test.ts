import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@queuesprout/db';
import { createTestDatabase, type TestDatabase } from '@queuesprout/db/testing';
import { createStorage, originalKey, putObject, type Storage } from '@queuesprout/storage';
import { createMediaResolver } from './resolver';

const { mediaAssets, workspaces } = schema;

/** Needs Postgres and an S3-compatible server (SeaweedFS in CI), like the probe tests. */
const endpoint = process.env.TEST_S3_ENDPOINT;

const SPEC = { maxBytes: 1_000_000, maxEdgePx: 2000, mimeTypes: ['image/jpeg', 'image/png'] };

describe.skipIf(!endpoint)('media resolver (real Postgres and S3)', () => {
  let t: TestDatabase;
  let storage: Storage;
  let workspaceId: string;
  let otherWorkspaceId: string;

  async function media(status: 'uploading' | 'processing' | 'ready' | 'failed', put = true) {
    const id = randomUUID();
    const storageKey = originalKey(workspaceId, id, 'png');
    const body = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: '#23804A' },
    })
      .png()
      .toBuffer();
    if (put) await putObject(storage, storageKey, body, 'image/png');
    await t.owner.insert(mediaAssets).values({
      id,
      workspaceId,
      filename: 'a.png',
      mime: 'image/png',
      bytes: body.byteLength,
      storageKey,
      status,
      ...(status === 'ready' && { width: 3000, height: 1500 }),
    });
    return id;
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    storage = createStorage({
      endpoint: endpoint ?? 'http://localhost:8333',
      bucket: process.env.TEST_S3_BUCKET ?? 'queuesprout-media',
      accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'queuesprout',
      secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'queuesprout-s3-secret',
      forcePathStyle: true,
    });
    const rows = await t.owner
      .insert(workspaces)
      .values([
        { name: 'Acme', slug: `acme-${randomUUID().slice(0, 8)}` },
        { name: 'Other', slug: `other-${randomUUID().slice(0, 8)}` },
      ])
      .returning();
    const [ws, other] = rows;
    if (!ws || !other) throw new Error('no workspace');
    workspaceId = ws.id;
    otherWorkspaceId = other.id;
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('returns a ready image fitted to the spec, with info and a URL', async () => {
    const id = await media('ready');
    const resolver = createMediaResolver({ db: t.owner, storage, workspaceId });

    const result = await resolver.getFile(id, SPEC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.file.mime, result.file.width, result.file.height]).toEqual([
      'image/png',
      2000,
      1000,
    ]);

    expect(await resolver.getInfo(id)).toMatchObject({ id, mime: 'image/png', width: 3000 });
    expect(await resolver.getUrl(id)).toMatch(/^https?:\/\//);
  });

  it('asks for a retry while the image is still being checked', async () => {
    const resolver = createMediaResolver({ db: t.owner, storage, workspaceId });
    for (const status of ['uploading', 'processing'] as const) {
      expect(await resolver.getFile(await media(status), SPEC)).toMatchObject({
        ok: false,
        retryable: true,
      });
    }
  });

  it('refuses failed, missing and foreign images without a retry', async () => {
    const resolver = createMediaResolver({ db: t.owner, storage, workspaceId });
    expect(await resolver.getFile(await media('failed'), SPEC)).toMatchObject({
      ok: false,
      retryable: false,
    });
    expect(await resolver.getFile(await media('ready', false), SPEC)).toMatchObject({
      ok: false,
      retryable: false,
      message: expect.stringMatching(/missing from storage/),
    });
    const foreign = createMediaResolver({
      db: t.owner,
      storage,
      workspaceId: otherWorkspaceId,
    });
    expect(await foreign.getFile(await media('ready'), SPEC)).toMatchObject({
      ok: false,
      retryable: false,
      message: expect.stringMatching(/no longer exists/),
    });
  });

  it('refuses every image when the worker has no storage', async () => {
    const resolver = createMediaResolver({ db: t.owner, storage: null, workspaceId });
    expect(await resolver.getFile(await media('ready'), SPEC)).toMatchObject({
      ok: false,
      retryable: false,
    });
  });

  it('asks for a retry when storage is unreachable', async () => {
    const down = createStorage({
      endpoint: 'http://127.0.0.1:1',
      bucket: 'queuesprout-media',
      accessKeyId: 'x',
      secretAccessKey: 'y',
      forcePathStyle: true,
    });
    const resolver = createMediaResolver({ db: t.owner, storage: down, workspaceId });
    expect(await resolver.getFile(await media('ready'), SPEC)).toMatchObject({
      ok: false,
      retryable: true,
    });
  });
});
