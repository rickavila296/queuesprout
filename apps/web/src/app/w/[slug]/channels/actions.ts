'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertRole, ForbiddenError } from '@queuesprout/auth';
import { encryptCredentials } from '@queuesprout/core/credentials';
import { connectAccount, getWorkspace, removeChannel, upsertChannel } from '@queuesprout/db';
import { demoAccount } from '@queuesprout/providers/client';
import { fail, ok, providerIdSchema, workspaceSlugSchema } from '@queuesprout/shared';
import { unexpected, type FormState } from '@/lib/actions';
import { dataAccess } from '@/lib/db';
import { keyring } from '@/lib/keyring';
import { providerLabel } from '@/lib/providers';
import { workspaceIsMock } from '@/lib/publish-mode';
import { requireWorkspace } from '@/lib/session';

const demoSchema = z.object({ workspaceSlug: workspaceSlugSchema, provider: providerIdSchema });

/**
 * Adds a fake account and channel for one provider, with no OAuth. Only offered when the
 * workspace publishes in mock mode, and the worker re-checks that before every step.
 */
export async function connectDemoChannelAction(
  _prev: FormState<{ name: string }>,
  formData: FormData,
): Promise<FormState<{ name: string }>> {
  const parsed = demoSchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    provider: formData.get('provider'),
  });
  if (!parsed.success) return fail('Pick a provider.');
  const { workspaceSlug, provider } = parsed.data;

  const { ctx } = await requireWorkspace(workspaceSlug);
  try {
    assertRole(ctx, 'admin');
    const keys = keyring();
    if (!keys) return fail('Set TOKEN_ENCRYPTION_KEY in .env, then restart the app.');

    const name = await dataAccess().withWorkspace(ctx, async (tx) => {
      const workspace = await getWorkspace(tx, ctx.workspaceId);
      if (!workspace || !workspaceIsMock(workspace)) return null;

      const account = demoAccount(provider);
      const encrypted = encryptCredentials(
        keys,
        { workspaceId: ctx.workspaceId, provider, externalAccountId: account.externalAccountId },
        account.creds,
      );
      const connected = await connectAccount(tx, {
        workspaceId: ctx.workspaceId,
        provider,
        externalAccountId: account.externalAccountId,
        displayName: account.displayName,
        ...encrypted,
      });
      if (!connected.ok) throw new ForbiddenError('admin');
      for (const target of account.targets) {
        await upsertChannel(tx, {
          workspaceId: ctx.workspaceId,
          accountId: connected.accountId,
          provider,
          targetType: target.targetType,
          externalTargetId: target.externalTargetId,
          name: target.name,
          handle: target.handle ?? null,
          avatarUrl: target.avatarUrl ?? null,
          defaultSettings: target.defaultSettings ?? {},
        });
      }
      return account.displayName;
    });
    if (!name) return fail('Demo channels are only available in sandbox mode.');

    revalidatePath(`/w/${workspaceSlug}/channels`);
    return ok({ name: `${name} (${providerLabel(provider)})` });
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(error.message);
    return unexpected('connectDemoChannel', error);
  }
}

const removeSchema = z.object({ workspaceSlug: workspaceSlugSchema, channelId: z.uuid() });

export async function removeChannelAction(formData: FormData): Promise<void> {
  const parsed = removeSchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    channelId: formData.get('channelId'),
  });
  if (!parsed.success) return;
  const { ctx } = await requireWorkspace(parsed.data.workspaceSlug);
  assertRole(ctx, 'admin');
  await dataAccess().withWorkspace(ctx, (tx) =>
    removeChannel(tx, ctx.workspaceId, parsed.data.channelId),
  );
  revalidatePath(`/w/${parsed.data.workspaceSlug}`, 'layout');
}
