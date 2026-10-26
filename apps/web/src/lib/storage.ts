import 'server-only';
import { createStorage, type Storage } from '@queuesprout/storage';
import { env } from '@/env';

const globalForStorage = globalThis as unknown as { qsStorage?: Storage | null };

/** The media bucket, or null when S3_* is not configured (uploads show a setup message). */
export function storage(): Storage | null {
  if (globalForStorage.qsStorage !== undefined) return globalForStorage.qsStorage;
  const e = env();
  globalForStorage.qsStorage =
    e.S3_ENDPOINT && e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY
      ? createStorage({
          endpoint: e.S3_ENDPOINT,
          region: e.S3_REGION,
          bucket: e.S3_BUCKET,
          accessKeyId: e.S3_ACCESS_KEY_ID,
          secretAccessKey: e.S3_SECRET_ACCESS_KEY,
          forcePathStyle: e.S3_FORCE_PATH_STYLE,
        })
      : null;
  return globalForStorage.qsStorage;
}
