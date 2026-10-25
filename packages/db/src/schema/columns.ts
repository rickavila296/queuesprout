import { customType, timestamp } from 'drizzle-orm/pg-core';

/** Encrypted secrets (AES-256-GCM blobs from @queuesprout/core/credentials). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
/** Maintained by the app.set_updated_at() trigger (hand-written migration). */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
