'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertRole, ForbiddenError } from '@queuesprout/auth';
import {
  confirmMedia,
  deleteMedia,
  getMedia,
  reserveMedia,
  type ConfirmMediaError,
  type ReserveMediaError,
} from '@queuesprout/db';
import {
  createUploadSchema,
  extensionForMime,
  fail,
  ok,
  workspaceSlugSchema,
  type ActionResult,
} from '@queuesprout/shared';
import { headObject, originalKey, presignPut } from '@queuesprout/storage';
import { unexpected } from '@/lib/actions';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { storage } from '@/lib/storage';

const NO_STORAGE = 'Media storage is not set up yet. Set the S3_* variables in .env.';

const RESERVE_MESSAGES: Record<ReserveMediaError, string> = {
  forbidden: 'Only editors can upload media.',
  quota_exceeded: 'This workspace is out of storage. Delete some media first.',
  invalid_key: 'Something went wrong. Try again.',
};

const CONFIRM_MESSAGES: Record<ConfirmMediaError, string> = {
  not_found: 'This upload no longer exists. Upload the file again.',
  forbidden: 'Only editors can upload media.',
  not_uploading: 'This file was already uploaded.',
  size_mismatch: 'The uploaded file does not match what was declared. Upload it again.',
};

export interface UploadTicket {
  mediaId: string;
  /** Presigned PUT, valid 15 minutes, bound to this content type and length. */
  uploadUrl: string;
  contentType: string;
}

/**
 * Upload steps 1 and 2 (ADR-015): checks the file, reserves a row inside the quota and
 * returns a presigned PUT. The bytes go straight from the browser to the bucket.
 */
export async function createUploadAction(
  workspaceSlug: unknown,
  file: unknown,
): Promise<ActionResult<UploadTicket>> {
  const slug = workspaceSlugSchema.safeParse(workspaceSlug);
  if (!slug.success) return fail('Something is wrong with this page. Refresh it.');
  const parsed = createUploadSchema.safeParse(file);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'This file cannot be used.');
  const { filename, mime, bytes, retention } = parsed.data;

  const { ctx } = await requireWorkspace(slug.data);
  const bucket = storage();
  if (!bucket) return fail(NO_STORAGE);
  try {
    assertRole(ctx, 'editor');
    const mediaId = randomUUID();
    const storageKey = originalKey(ctx.workspaceId, mediaId, extensionForMime(mime));
    const reserved = await dataAccess().withWorkspace(ctx, (tx) =>
      reserveMedia(tx, {
        workspaceId: ctx.workspaceId,
        mediaId,
        filename,
        mime,
        bytes,
        retention,
        storageKey,
      }),
    );
    if (!reserved.ok) return fail(RESERVE_MESSAGES[reserved.error]);
    const uploadUrl = await presignPut(bucket, storageKey, mime, bytes);
    return ok({ mediaId, uploadUrl, contentType: mime });
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(error.message);
    return unexpected('createUpload', error);
  }
}

/**
 * Upload step 4: the browser finished its PUT. Never trusts the browser: the object must
 * be in the bucket with the reserved type and size. Then media.probe takes over.
 */
export async function completeUploadAction(
  workspaceSlug: unknown,
  mediaId: unknown,
): Promise<ActionResult<{ mediaId: string }>> {
  const slug = workspaceSlugSchema.safeParse(workspaceSlug);
  const id = z.uuid().safeParse(mediaId);
  if (!slug.success || !id.success) return fail('Something is wrong with this page. Refresh it.');

  const { ctx } = await requireWorkspace(slug.data);
  const bucket = storage();
  if (!bucket) return fail(NO_STORAGE);
  try {
    assertRole(ctx, 'editor');
    const media = await dataAccess().withWorkspace(ctx, (tx) =>
      getMedia(tx, ctx.workspaceId, id.data),
    );
    if (!media) return fail(CONFIRM_MESSAGES.not_found);
    if (media.status !== 'uploading') return ok({ mediaId: media.id });

    const stored = await headObject(bucket, media.storageKey);
    if (!stored) return fail('The file did not reach storage. Upload it again.');
    if (stored.contentType !== media.mime) return fail(CONFIRM_MESSAGES.size_mismatch);

    const confirmed = await dataAccess().withWorkspace(ctx, (tx) =>
      confirmMedia(tx, media.id, stored.bytes),
    );
    if (!confirmed.ok) return fail(CONFIRM_MESSAGES[confirmed.error]);
    revalidatePath(`/w/${slug.data}/media`);
    return ok({ mediaId: media.id });
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(error.message);
    return unexpected('completeUpload', error);
  }
}

const deleteSchema = z.object({ workspaceSlug: workspaceSlugSchema, mediaId: z.uuid() });

/** Hides the file now; the retention job removes it once no scheduled post uses it. */
export async function deleteMediaAction(formData: FormData): Promise<void> {
  const parsed = deleteSchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    mediaId: formData.get('mediaId'),
  });
  if (!parsed.success) return;
  const { ctx } = await requireWorkspace(parsed.data.workspaceSlug);
  assertRole(ctx, 'editor');
  await dataAccess().withWorkspace(ctx, (tx) =>
    deleteMedia(tx, ctx.workspaceId, parsed.data.mediaId),
  );
  revalidatePath(`/w/${parsed.data.workspaceSlug}/media`);
}
