'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertRole, ForbiddenError } from '@queuesprout/auth';
import { getWorkspace, reschedulePost } from '@queuesprout/db';
import {
  fail,
  ok,
  wallTimeToUtc,
  WALL_TIME_PATTERN,
  workspaceSlugSchema,
  type ActionResult,
} from '@queuesprout/shared';
import { PAST_SLACK_MS } from '@/lib/compose';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';

const rescheduleSchema = z.object({
  workspaceSlug: workspaceSlugSchema,
  postId: z.uuid(),
  version: z.number().int().positive(),
  /** New time in the workspace timezone. */
  wall: z.string().regex(WALL_TIME_PATTERN),
});
export type RescheduleInput = z.infer<typeof rescheduleSchema>;

const MESSAGES = {
  not_found: 'This post no longer exists.',
  conflict: 'This post changed in another tab. Reload to see the latest.',
  locked: 'This post is already publishing, so it cannot move.',
  past: 'A scheduled post cannot move into the past.',
  invalid: 'Pick a valid date and time.',
} as const;

/** Moves one post (calendar drag, "Move to…", undo). Returns its new version. */
export async function reschedulePostAction(
  input: RescheduleInput,
): Promise<ActionResult<{ version: number }>> {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return fail(MESSAGES.invalid);
  const { workspaceSlug, postId, version, wall } = parsed.data;

  const { ctx } = await requireWorkspace(workspaceSlug);
  try {
    assertRole(ctx, 'editor');
    const result = await dataAccess().withWorkspace(ctx, async (tx) => {
      const workspace = await getWorkspace(tx, ctx.workspaceId);
      const scheduledAt = workspace ? wallTimeToUtc(wall, workspace.timezone) : null;
      if (!scheduledAt) return { ok: false as const, error: 'invalid' as const };
      return reschedulePost(tx, {
        workspaceId: ctx.workspaceId,
        postId,
        version,
        scheduledAt,
        earliest: new Date(Date.now() - PAST_SLACK_MS),
      });
    });
    if (!result.ok) return fail(MESSAGES[result.error]);
    revalidatePath(`/w/${workspaceSlug}`);
    return ok({ version: result.version });
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(error.message);
    console.error('[reschedulePost]', error);
    return fail('Something went wrong. Try again.');
  }
}
