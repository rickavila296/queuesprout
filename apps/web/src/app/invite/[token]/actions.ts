'use server';

import { redirect } from 'next/navigation';
import { acceptInvite } from '@queuesprout/db';
import { fail, type ActionResult } from '@queuesprout/shared';
import { dataAccess } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { hashToken } from '@/lib/tokens';

const MESSAGES = {
  invite_invalid: 'This invite has expired, was revoked, or was already used.',
  invite_email_mismatch: 'This invite was sent to a different email address.',
} as const;

export async function acceptInviteAction(
  token: string,
  _prev: ActionResult<never> | null,
): Promise<ActionResult<never> | null> {
  const user = await requireUser(`/invite/${token}`);
  const result = await dataAccess().withUser(user.id, (tx) => acceptInvite(tx, hashToken(token)));
  if (!result.ok) return fail(MESSAGES[result.error]);
  redirect(`/w/${result.workspaceSlug}`);
}
