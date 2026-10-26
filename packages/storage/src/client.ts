import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';

/** ADR-014: any S3-compatible bucket. Cloudflare R2 in the cloud, SeaweedFS when self-hosted (ADR-022). */
export const storageConfigSchema = z.object({
  endpoint: z.url(),
  region: z.string().default('auto'),
  bucket: z.string().min(3),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  /** SeaweedFS needs path-style URLs; R2 works with either. */
  forcePathStyle: z.boolean().default(false),
});
export type StorageConfig = z.infer<typeof storageConfigSchema>;

export interface Storage {
  client: S3Client;
  bucket: string;
}

export function createStorage(input: z.input<typeof storageConfigSchema>): Storage {
  const config = storageConfigSchema.parse(input);
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    // The SDK otherwise signs a CRC32 of an empty body into presigned PUT URLs, so every
    // browser upload fails with BadDigest. Only send checksums when an operation requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Without these a stalled connection never settles, and the worker's media check, which
    // runs one tick at a time, would wait on it forever and leave every later upload at
    // "Checking". requestTimeout is socket inactivity, so slow but moving transfers are fine.
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
  });
  return { client, bucket: config.bucket };
}

/** Fails fast at boot when the bucket is missing or the keys are wrong. */
export async function checkBucket(storage: Storage): Promise<void> {
  await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
}
