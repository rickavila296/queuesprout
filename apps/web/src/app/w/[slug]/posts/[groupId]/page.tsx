import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { hasRole } from '@queuesprout/core';
import {
  COMPOSER_EDITABLE,
  getPostGroup,
  getPublishHistory,
  getWorkspace,
  listChannels,
} from '@queuesprout/db';
import { isOverride, toWallTime } from '@queuesprout/shared';
import { deletePostGroupAction } from '@/app/w/[slug]/compose/actions';
import { Composer, type ComposerInitial } from '@/components/composer/composer';
import { ConfirmButton } from '@/components/confirm-button';
import { toComposerChannels } from '@/components/composer/load';
import { defaultScheduleWall } from '@/lib/compose';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { DeliveryList, type DeliveryPost } from './delivery';

export const metadata: Metadata = { title: 'Edit post' };

const editable = (status: string) => (COMPOSER_EDITABLE as readonly string[]).includes(status);

export default async function EditPostPage({ params }: PageProps<'/w/[slug]/posts/[groupId]'>) {
  const { slug, groupId } = await params;
  if (!z.uuid().safeParse(groupId).success) notFound();
  const { ctx } = await requireWorkspace(slug);
  const canEdit = hasRole(ctx.role, 'editor');

  const { workspace, channels, group, history } = await dataAccess().withWorkspace(
    ctx,
    async (tx) => {
      const group = await getPostGroup(tx, ctx.workspaceId, groupId);
      return {
        workspace: await getWorkspace(tx, ctx.workspaceId),
        channels: await listChannels(tx, ctx.workspaceId),
        group,
        history: await getPublishHistory(tx, ctx.workspaceId, group?.posts.map((p) => p.id) ?? []),
      };
    },
  );
  if (!workspace || !group || group.posts.length === 0) notFound();
  const tz = workspace.timezone;

  // A post with parts already out (a retried thread) is never re-edited: that would resend them.
  const isOpen = (p: (typeof group.posts)[number]) => editable(p.status) && p.sentItems === 0;
  const open = group.posts.filter(isOpen);
  const frozen = group.posts.filter((p) => !isOpen(p));
  const first = open[0];
  const initial: ComposerInitial = {
    groupId: group.id,
    baseItems: group.baseItems,
    picks: open.map((p) => ({
      channelId: p.channelId,
      items: isOverride(group.baseItems, p.items) ? p.items : null,
      version: p.version,
    })),
    frozen: frozen.map((p) => ({
      channelId: p.channelId,
      status: p.status,
      externalUrl: p.externalUrl,
    })),
    mode: first?.status === 'draft' || first?.status === 'cancelled' ? 'draft' : 'schedule',
    scheduledAt: first?.scheduledAt
      ? toWallTime(first.scheduledAt, tz)
      : defaultScheduleWall(new Date(), tz),
  };

  const showComposer = canEdit && open.length > 0;
  const delivery = (showComposer ? frozen : group.posts).map((p): DeliveryPost => {
    const channel = channels.find((c) => c.id === p.channelId);
    return {
      ...p,
      channel: channel?.name ?? 'Removed channel',
      provider: channel?.provider ?? null,
      history: history.get(p.id),
    };
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{showComposer ? 'Edit post' : 'Post'}</h1>
        {showComposer && (
          <form action={deletePostGroupAction}>
            <input type="hidden" name="workspaceSlug" value={slug} />
            <input type="hidden" name="groupId" value={group.id} />
            <ConfirmButton
              variant="ghost"
              size="sm"
              confirmText="Delete this post from every channel it has not reached yet?"
            >
              Delete{frozen.length > 0 ? ' unpublished' : ''}
            </ConfirmButton>
          </form>
        )}
      </div>
      {showComposer && (
        <Composer
          workspaceSlug={slug}
          timezone={tz}
          channels={toComposerChannels(channels)}
          initial={initial}
        />
      )}
      {delivery.length > 0 && (
        <section aria-labelledby="delivery-heading" className="flex flex-col gap-3">
          {showComposer && (
            <h2 id="delivery-heading" className="font-medium">
              Already sent or in progress
            </h2>
          )}
          {!showComposer && (
            <h2 id="delivery-heading" className="sr-only">
              Channels
            </h2>
          )}
          <DeliveryList
            posts={delivery}
            timezone={tz}
            workspaceSlug={slug}
            groupId={group.id}
            canRetry={canEdit}
            showText={!showComposer}
          />
        </section>
      )}
    </div>
  );
}
