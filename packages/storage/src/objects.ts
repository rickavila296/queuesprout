import { HeadObjectCommand, NotFound } from '@aws-sdk/client-s3';
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
