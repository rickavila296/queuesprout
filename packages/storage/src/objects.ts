import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { Storage } from './client';

export interface StoredObject {
  bytes: number;
  contentType: string | undefined;
}

/** Size and type of an object as the bucket stored it, or null when it is not there. */
export async function headObject(storage: Storage, key: string): Promise<StoredObject | null> {
  try {
    const head = await storage.client.send(
      new HeadObjectCommand({ Bucket: storage.bucket, Key: key }),
    );
    return { bytes: head.ContentLength ?? 0, contentType: head.ContentType };
  } catch (error) {
    if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return null;
    throw error;
  }
}

/** Downloads an object into memory, refusing anything larger than maxBytes. Null when missing. */
export async function getObjectBytes(
  storage: Storage,
  key: string,
  maxBytes: number,
): Promise<Uint8Array | null> {
  try {
    const res = await storage.client.send(
      new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
    );
    if (!res.Body) return null;
    if ((res.ContentLength ?? 0) > maxBytes) {
      res.Body.transformToWebStream()
        .cancel()
        .catch(() => undefined);
      throw new Error(`Object ${key} is larger than ${maxBytes} bytes.`);
    }
    return await res.Body.transformToByteArray();
  } catch (error) {
    if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey')
      return null;
    throw error;
  }
}

export async function putObject(
  storage: Storage,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await storage.client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** Removes an object. Removing one that is not there succeeds, so a retry is safe. */
export async function deleteObject(storage: Storage, key: string): Promise<void> {
  await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }));
}
