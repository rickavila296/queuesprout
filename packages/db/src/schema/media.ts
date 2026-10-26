import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { MEDIA_RETENTIONS, MEDIA_STATUSES } from '@queuesprout/shared';
import { createdAt, updatedAt } from './columns';
import { postItems } from './posts';
import { profiles, workspaces } from './workspaces';

export const mediaStatus = pgEnum('media_status', MEDIA_STATUSES);
export const mediaRetention = pgEnum('media_retention', MEDIA_RETENTIONS);

/**
 * Uploaded files (ADR-015). Rows are created by app.reserve_media() and moved to
 * processing by app.confirm_media(); everything the worker learns about the file
 * (dimensions, hash, variants, ready/failed/purged) is written by the worker only.
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    /** The name it was uploaded with, for display only. Never part of the storage key. */
    filename: text('filename').notNull(),
    /** Declared at upload; the worker replaces it with the sniffed type. */
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    /** ws/{workspace_id}/{media_id}/original.{ext} */
    storageKey: text('storage_key').notNull().unique(),
    status: mediaStatus('status').notNull().default('uploading'),
    retention: mediaRetention('retention').notNull().default('auto'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    sha256: text('sha256'),
    thumbnailKey: text('thumbnail_key'),
    /** Platform variants made at publish time: {"instagram": "ws/.../instagram.jpg"}. */
    variants: jsonb('variants').$type<Record<string, string>>().notNull().default({}),
    errorMessage: text('error_message'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('media_assets_bytes_positive', sql`${t.bytes} > 0`),
    index('media_assets_library_idx')
      .on(t.workspaceId, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    index('media_assets_processing_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} = 'processing'`),
    unique('media_assets_id_workspace_key').on(t.id, t.workspaceId),
  ],
);

/** Media attached to a post item, in order, with per-attachment alt text. */
export const postItemMedia = pgTable(
  'post_item_media',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    postItemId: uuid('post_item_id').notNull(),
    position: smallint('position').notNull(),
    mediaId: uuid('media_id').notNull(),
    altText: text('alt_text').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.postItemId, t.position] }),
    unique('post_item_media_item_media_key').on(t.postItemId, t.mediaId),
    index('post_item_media_media_idx').on(t.mediaId),
    check('post_item_media_position_nonnegative', sql`${t.position} >= 0`),
    check('post_item_media_alt_length', sql`char_length(${t.altText}) <= 2000`),
    foreignKey({
      name: 'post_item_media_item_fk',
      columns: [t.postItemId, t.workspaceId],
      foreignColumns: [postItems.id, postItems.workspaceId],
    }).onDelete('cascade'),
    // Restrict: media in use is soft-deleted and purged by the retention job, never dropped.
    foreignKey({
      name: 'post_item_media_media_fk',
      columns: [t.mediaId, t.workspaceId],
      foreignColumns: [mediaAssets.id, mediaAssets.workspaceId],
    }).onDelete('restrict'),
  ],
);
