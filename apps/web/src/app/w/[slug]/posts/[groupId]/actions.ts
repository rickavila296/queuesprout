'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertRole, ForbiddenError } from '@queuesprout/auth';
import { retryPost, type RetryError } from '@queuesprout/db';
import { fail, ok, workspaceSlugSchema } from '@queuesprout/shared';
import { unexpected, type FormState } from '@/lib/actions';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';

const retrySchema = z.object({
  workspaceSlug: workspaceSlugSchema,
  groupId: z.uuid(),
  postId: z.uuid(),
  confirmUnknown: z.literal('on').optional(),
});

const RETRY_MESSAGES: Record<RetryError, string> = {
  not_found: 'This post no longer exists.',
  forbidden: 'Only editors can retry posts.',
  not_failed: 'This post is no longer failed. Refresh the page.',
  confirm_required: 'Check the platform first, then tick the box to confirm.',
  account_needs_reauth: 'Reconnect this account on the Channels page first.',
  channel_unavailable: 'This channel is unavailable. Check it on the Channels page.',
};

/**
 * Sends a failed post back to the queue for now. Items already published are kept, so
 * only what failed or never went out is sent. Editors only.
 */
export async function retryPostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = retrySchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    groupId: formData.get('groupId'),
    postId: formData.get('postId'),
    confirmUnknown: formData.get('confirmUnknown') ?? undefined,
  });
  if (!parsed.success) return fail('Something is wrong with this form. Refresh the page.');
  const { workspaceSlug, groupId, postId, confirmUnknown } = parsed.data;

  const { ctx } = await requireWorkspace(workspaceSlug);
  try {
    assertRole(ctx, 'editor');
    const result = await dataAccess().withWorkspace(ctx, (tx) =>
      retryPost(tx, postId, confirmUnknown === 'on'),
    );
    if (!result.ok) return fail(RETRY_MESSAGES[result.error]);
    revalidatePath(`/w/${workspaceSlug}/posts/${groupId}`);
    revalidatePath(`/w/${workspaceSlug}`, 'layout');
    return ok(undefined);
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(error.message);
    return unexpected('retryPost', error);
  }
}
