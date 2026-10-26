import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ATTEMPT_OUTCOMES,
  ITEM_STATUSES,
  POST_STATUSES,
  type PostItemKind,
  type PublishCheckpoint,
  type PublishErrorKind,
} from '@queuesprout/shared';
import { channels } from './accounts';
import { createdAt, updatedAt } from './columns';
import { profiles, workspaces } from './workspaces';

export const postStatus = pgEnum('post_status', POST_STATUSES);
export const itemStatus = pgEnum('item_status', ITEM_STATUSES);
export const attemptOutcome = pgEnum('attempt_outcome', ATTEMPT_OUTCOMES);

/** One compose action across channels. Approval columns arrive with the approval workflow. */
export const postGroups = pgTable(
  'post_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    baseBody: text('base_body').notNull().default(''),
    /** Thread replies after base_body; channels without an override publish this thread. */
    baseReplies: text('base_replies')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('post_groups_workspace_idx').on(t.workspaceId),
    unique('post_groups_id_workspace_key').on(t.id, t.workspaceId),
  ],
);

/** The per-channel post and its lifecycle (ADR-011). */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    status: postStatus('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Validated by the adapter's settingsSchema. */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    /** Item 0's id, for links and metrics. */
    externalId: text('external_id'),
    externalUrl: text('external_url'),
    /** The current item's creation_id or publish_id. */
    externalContainerId: text('external_container_id'),
    /** PublishCheckpoint plus the item position it belongs to. */
    publishCheckpoint: jsonb('publish_checkpoint').$type<
      PublishCheckpoint & { position: number }
    >(),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
    processingDeadlineAt: timestamp('processing_deadline_at', { withTimezone: true }),
    errorKind: text('error_kind').$type<PublishErrorKind>(),
    errorMessage: text('error_message'),
    attemptCount: integer('attempt_count').notNull().default(0),
    /** Set once the failure email for this post went out; cleared when it is retried. */
    failureNotifiedAt: timestamp('failure_notified_at', { withTimezone: true }),
    /** Optimistic concurrency for edits (drag-to-reschedule vs another tab). */
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'posts_scheduled_has_time',
      sql`${t.status} <> 'scheduled' or ${t.scheduledAt} is not null`,
    ),
    check(
      'posts_processing_has_check',
      sql`${t.status} <> 'processing' or ${t.nextCheckAt} is not null`,
    ),
    check(
      'posts_error_kind_valid',
      sql`${t.errorKind} is null or ${t.errorKind} in ('auth', 'rate_limit', 'validation', 'transient', 'expired', 'unknown')`,
    ),
    index('posts_due_idx')
      .on(t.scheduledAt)
      .where(sql`${t.status} = 'scheduled' and ${t.deletedAt} is null`),
    index('posts_check_idx')
      .on(t.nextCheckAt)
      .where(sql`${t.status} = 'processing'`),
    index('posts_calendar_idx')
      .on(t.workspaceId, t.scheduledAt)
      .where(sql`${t.deletedAt} is null`),
    index('posts_unnotified_failures_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} = 'failed' and ${t.failureNotifiedAt} is null`),
    index('posts_group_idx').on(t.groupId),
    index('posts_channel_idx').on(t.channelId),
    unique('posts_id_workspace_key').on(t.id, t.workspaceId),
    // Composite foreign keys: RLS checks posts.workspace_id, and these make sure the
    // group and channel belong to that same workspace (a foreign key ignores RLS).
    foreignKey({
      name: 'posts_group_fk',
      columns: [t.groupId, t.workspaceId],
      foreignColumns: [postGroups.id, postGroups.workspaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'posts_channel_fk',
      columns: [t.channelId, t.workspaceId],
      foreignColumns: [channels.id, channels.workspaceId],
    }).onDelete('cascade'),
  ],
);

/** Ordered parts: item 0 is the post, later items are thread replies or the first comment. */
export const postItems = pgTable(
  'post_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').notNull(),
    position: smallint('position').notNull(),
    kind: text('kind').$type<PostItemKind>().notNull().default('post'),
    body: text('body').notNull().default(''),
    status: itemStatus('status').notNull().default('pending'),
    externalId: text('external_id'),
    externalUrl: text('external_url'),
    /** Bluesky {"uri", "cid"}; platform media ids. */
    externalMeta: jsonb('external_meta').$type<Record<string, unknown>>().notNull().default({}),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('post_items_position_idx').on(t.postId, t.position),
    check('post_items_position_nonnegative', sql`${t.position} >= 0`),
    check('post_items_kind_valid', sql`${t.kind} in ('post', 'reply', 'first_comment')`),
    foreignKey({
      name: 'post_items_post_fk',
      columns: [t.postId, t.workspaceId],
      foreignColumns: [posts.id, posts.workspaceId],
    }).onDelete('cascade'),
  ],
);

/** One row per publish step. Written by the worker only. */
export const publishAttempts = pgTable(
  'publish_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').notNull(),
    postItemId: uuid('post_item_id').references(() => postItems.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    stage: text('stage'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    outcome: attemptOutcome('outcome'),
    errorKind: text('error_kind').$type<PublishErrorKind>(),
    httpStatus: smallint('http_status'),
    /** Platform response with tokens and personal data removed. */
    responseRedacted: jsonb('response_redacted'),
  },
  (t) => [
    index('publish_attempts_post_idx').on(t.postId, t.startedAt),
    foreignKey({
      name: 'publish_attempts_post_fk',
      columns: [t.postId, t.workspaceId],
      foreignColumns: [posts.id, posts.workspaceId],
    }).onDelete('cascade'),
  ],
);
