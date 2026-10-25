'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertRole, ForbiddenError } from '@queuesprout/auth';
import { canInviteAs } from '@queuesprout/core';
import { createInvite, getWorkspace, revokeInvite } from '@queuesprout/db';
import {
  fail,
  INVITE_TTL_DAYS,
  inviteMemberSchema,
  ok,
  workspaceSlugSchema,
} from '@queuesprout/shared';
import { invalid, unexpected, type FormState } from '@/lib/actions';
import { dataAccess } from '@/lib/db';
import { linkEmail, sendEmail } from '@/lib/email';
import { requireWorkspace } from '@/lib/session';
import { hashToken, newToken } from '@/lib/tokens';
import { env } from '@/env';

export async function inviteMemberAction(
  _prev: FormState<{ email: string }>,
  formData: FormData,
): Promise<FormState<{ email: string }>> {
  const parsed = inviteMemberSchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    email: formData.get('email'),
    role: formData.get('role'),
  });
  if (!parsed.success) return invalid(parsed.error);
  const { workspaceSlug, email, role } = parsed.data;

  const { user, ctx } = await requireWorkspace(workspaceSlug);
  try {
    assertRole(ctx, 'admin');
    if (!canInviteAs(ctx.role, role)) return fail('You cannot invite with that role.');
    if (email === user.email.toLowerCase()) return fail('You are already a member.');

    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
    const workspace = await dataAccess().withWorkspace(ctx, async (tx) => {
      await createInvite(tx, {
        workspaceId: ctx.workspaceId,
        invitedBy: user.id,
        email,
        role,
        tokenHash: hashToken(token),
        expiresAt,
      });
      return getWorkspace(tx, ctx.workspaceId);
    });

    const url = `${env().PUBLIC_URL}/invite/${token}`;
    await sendEmail({
      to: email,
      subject: `${user.name || user.email} invited you to ${workspace?.name ?? 'QueueSprout'}`,
      ...linkEmail({
        heading: `Join ${workspace?.name ?? 'a workspace'} on QueueSprout`,
        body: `${user.name || user.email} invited you as ${role}. The invite expires in ${INVITE_TTL_DAYS} days.`,
        cta: 'Accept invite',
        url,
      }),
    });
    revalidatePath(`/w/${workspaceSlug}/settings/members`);
    return ok({ email });
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(error.message);
    return unexpected('inviteMember', error);
  }
}

const revokeSchema = z.object({ workspaceSlug: workspaceSlugSchema, inviteId: z.uuid() });

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const parsed = revokeSchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    inviteId: formData.get('inviteId'),
  });
  if (!parsed.success) return;
  const { ctx } = await requireWorkspace(parsed.data.workspaceSlug);
  assertRole(ctx, 'admin');
  await dataAccess().withWorkspace(ctx, (tx) =>
    revokeInvite(tx, ctx.workspaceId, parsed.data.inviteId),
  );
  revalidatePath(`/w/${parsed.data.workspaceSlug}/settings/members`);
}
