import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkBucket, createStorage } from './client';
import { originalKey } from './keys';
import { headObject } from './objects';
import { presignGet, presignPut } from './presign';

/**
 * Runs against a real S3-compatible server (SeaweedFS locally and in CI, ADR-022).
 * Set TEST_S3_ENDPOINT, TEST_S3_BUCKET, TEST_S3_ACCESS_KEY_ID and TEST_S3_SECRET_ACCESS_KEY.
 */
const endpoint = process.env.TEST_S3_ENDPOINT;

describe.skipIf(!endpoint)('S3 storage', () => {
  const storage = createStorage({
    endpoint: endpoint ?? 'http://localhost:8333',
    bucket: process.env.TEST_S3_BUCKET ?? 'queuesprout-media',
    accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'queuesprout',
    secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'queuesprout-s3-secret',
    forcePathStyle: true,
  });

  it('reaches the bucket', async () => {
    await expect(checkBucket(storage)).resolves.toBeUndefined();
  });

  it('round-trips a browser-style presigned PUT and GET', async () => {
    const key = originalKey(randomUUID(), randomUUID(), 'png');
    const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const putUrl = await presignPut(storage, key, 'image/png', body.byteLength);

    const put = await fetch(putUrl, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'image/png' },
    });
    expect(put.status).toBe(200);

    expect(await headObject(storage, key)).toEqual({
      bytes: body.byteLength,
      contentType: 'image/png',
    });

    const get = await fetch(await presignGet(storage, key));
    expect(get.status).toBe(200);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);
  });

  it('reports a missing object as null', async () => {
    expect(await headObject(storage, originalKey(randomUUID(), randomUUID(), 'png'))).toBeNull();
  });

  it('rejects a PUT whose content type differs from the signed one', async () => {
    const key = originalKey(randomUUID(), randomUUID(), 'png');
    const putUrl = await presignPut(storage, key, 'image/png', 4);
    const put = await fetch(putUrl, {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3, 4]),
      headers: { 'Content-Type': 'text/html' },
    });
    expect(put.status).toBe(403);
  });

  it('rejects a tampered presigned URL', async () => {
    const key = originalKey(randomUUID(), randomUUID(), 'png');
    const url = new URL(await presignGet(storage, key));
    url.searchParams.set('X-Amz-Signature', '0'.repeat(64));
    expect((await fetch(url)).status).toBe(403);
  });

  it('answers a browser CORS preflight for uploads', async () => {
    const key = originalKey(randomUUID(), randomUUID(), 'png');
    const res = await fetch(`${endpoint}/${storage.bucket}/${key}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toMatch(/\*|localhost:3000/);
  });
});
