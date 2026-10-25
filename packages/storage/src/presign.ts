import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Storage } from './client';

export const PUT_URL_TTL_SECONDS = 15 * 60;
export const GET_URL_TTL_SECONDS = 2 * 60 * 60;

/** Presigned PUT bound to the declared type and length (ADR-015). */
export function presignPut(
  storage: Storage,
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  return getSignedUrl(
    storage.client,
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    {
      expiresIn: PUT_URL_TTL_SECONDS,
      signableHeaders: new Set(['content-type', 'content-length']),
    },
  );
}

export function presignGet(storage: Storage, key: string): Promise<string> {
  return getSignedUrl(storage.client, new GetObjectCommand({ Bucket: storage.bucket, Key: key }), {
    expiresIn: GET_URL_TTL_SECONDS,
  });
}
