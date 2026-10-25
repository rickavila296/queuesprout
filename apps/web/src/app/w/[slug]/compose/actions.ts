'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assertRole, ForbiddenError } from '@queuesprout/auth';
import {
  deletePostGroup,
  getWorkspace,
  listChannels,
  savePostGroup,
  type SavePostGroupResult,
} from '@queuesprout/db';
import { composeSchema, effectiveItems, fail, workspaceSlugSchema } from '@queuesprout/shared';
import { invalid, unexpected, type FormState } from '@/lib/actions';
import { resolveSchedule, validateThread } from '@/lib/compose';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';

export type ComposeState = FormState;

const SAVE_ERRORS: Record<Exclude<SavePostGroupResult, { ok: true }>['error'], string> = {
  not_found: 'This post no longer exists.',
  conflict: 'Someone changed this post while you were editing. Reload to see their changes.',
  locked: 'A channel started publishing, so its post can no longer change. Reload to see it.',
  channel_unavailable: 'A channel is disconnected or needs reconnecting. Remove it to continue.',
};

type Outcome = { kind: 'saved'; groupId: string } | { kind: 'error'; state: ComposeState };

export async function saveComposeAction(
  _prev: ComposeState,
  formData: FormData,
): Promise<ComposeState> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return fail('The form could not be read. Reload and try again.');
  }
  const parsed = composeSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  const { ctx } = await requireWorkspace(input.workspaceSlug);
  let outcome: Outcome;
  try {
    assertRole(ctx, 'editor');
    outcome = await dataAccess().withWorkspace(ctx, async (tx): Promise<Outcome> => {
      const workspace = await getWorkspace(tx, ctx.workspaceId);
      if (!workspace) return { kind: 'error', state: fail('Workspace not found.') };

      const schedule = resolveSchedule(
        input.mode,
        input.scheduledAt,
        workspace.timezone,
        new Date(),
      );
      if (!schedule.ok) {
        return {
          kind: 'error',
          state: { ...fail(schedule.error), fieldErrors: { scheduledAt: schedule.error } },
        };
      }

      const channels = new Map((await listChannels(tx, ctx.workspaceId)).map((c) => [c.id, c]));
      const picks = input.channels.map((c) => ({
        channelId: c.channelId,
        version: c.version,
        items: effectiveItems(input.baseItems, c),
      }));

      // Drafts may be unfinished; anything headed for publishing must pass every check.
      if (schedule.status === 'scheduled') {
        const fieldErrors: Record<string, string> = {};
        for (const pick of picks) {
          const channel = channels.get(pick.channelId);
          if (!channel) continue; // savePostGroup reports it
          const first = validateThread(channel, pick.items).find((i) => i.severity === 'error');
          if (first) fieldErrors[`channel:${pick.channelId}`] = first.message;
        }
        if (Object.keys(fieldErrors).length > 0) {
          return {
            kind: 'error',
            state: { ...fail('Fix the channels marked below, or save a draft.'), fieldErrors },
          };
        }
      }

      const saved = await savePostGroup(tx, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        groupId: input.groupId,
        baseItems: input.baseItems,
        channels: picks,
        status: schedule.status,
        scheduledAt: schedule.scheduledAt,
      });
      if (!saved.ok) {
        const message = SAVE_ERRORS[saved.error];
        const fieldErrors = Object.fromEntries(
          (saved.channelIds ?? []).map((id) => [`channel:${id}`, message]),
        );
        return { kind: 'error', state: { ...fail(message), fieldErrors } };
      }
      return { kind: 'saved', groupId: saved.groupId };
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(error.message);
    return unexpected('saveCompose', error);
  }

  if (outcome.kind === 'error') return outcome.state;
  revalidatePath(`/w/${input.workspaceSlug}`, 'layout');
  redirect(`/w/${input.workspaceSlug}` as '/');
}

const deleteSchema = z.object({ workspaceSlug: workspaceSlugSchema, groupId: z.uuid() });

export async function deletePostGroupAction(formData: FormData): Promise<void> {
  const parsed = deleteSchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    groupId: formData.get('groupId'),
  });
  if (!parsed.success) return;
  const { ctx } = await requireWorkspace(parsed.data.workspaceSlug);
  assertRole(ctx, 'editor');
  await dataAccess().withWorkspace(ctx, (tx) =>
    deletePostGroup(tx, ctx.workspaceId, parsed.data.groupId),
  );
  revalidatePath(`/w/${parsed.data.workspaceSlug}`, 'layout');
  redirect(`/w/${parsed.data.workspaceSlug}` as '/');
}
