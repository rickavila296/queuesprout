import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { hasRole } from '@queuesprout/core';
import { COMPOSER_EDITABLE, getPostGroup, getWorkspace, listChannels } from '@queuesprout/db';
import { isOverride, toWallTime } from '@queuesprout/shared';
import { deletePostGroupAction } from '@/app/w/[slug]/compose/actions';
import { Composer, type ComposerInitial } from '@/components/composer/composer';
import { ConfirmButton } from '@/components/confirm-button';
import { toComposerChannels } from '@/components/composer/load';
import { defaultScheduleWall } from '@/lib/compose';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';

export const metadata: Metadata = { title: 'Edit post' };

const editable = (status: string) => (COMPOSER_EDITABLE as readonly string[]).includes(status);

export default async function EditPostPage({ params }: PageProps<'/w/[slug]/posts/[groupId]'>) {
  const { slug, groupId } = await params;
  if (!z.uuid().safeParse(groupId).success) notFound();
  const { ctx } = await requireWorkspace(slug);
  const canEdit = hasRole(ctx.role, 'editor');

  const { workspace, channels, group } = await dataAccess().withWorkspace(ctx, async (tx) => ({
    workspace: await getWorkspace(tx, ctx.workspaceId),
    channels: await listChannels(tx, ctx.workspaceId),
    group: await getPostGroup(tx, ctx.workspaceId, groupId),
  }));
  if (!workspace || !group || group.posts.length === 0) notFound();
  const tz = workspace.timezone;

  const open = group.posts.filter((p) => editable(p.status));
  const frozen = group.posts.filter((p) => !editable(p.status));
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {canEdit && open.length > 0 ? 'Edit post' : 'Post'}
        </h1>
        {canEdit && open.length > 0 && (
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
      {canEdit && open.length > 0 ? (
        <Composer
          workspaceSlug={slug}
          timezone={tz}
          channels={toComposerChannels(channels)}
          initial={initial}
        />
      ) : (
        <ReadOnlyGroup
          posts={group.posts.map((p) => ({
            ...p,
            channel: channels.find((c) => c.id === p.channelId)?.name ?? 'Removed channel',
            when: p.scheduledAt ? toWallTime(p.scheduledAt, tz).replace('T', ' ') : null,
          }))}
        />
      )}
    </div>
  );
}

function ReadOnlyGroup({
  posts,
}: {
  posts: {
    id: string;
    channel: string;
    status: string;
    when: string | null;
    externalUrl: string | null;
    errorMessage: string | null;
    items: string[];
  }[];
}) {
  return (
    <ul className="flex flex-col gap-4">
      {posts.map((p) => (
        <li key={p.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-sm">
            <span className="font-medium">{p.channel}</span>{' '}
            <span className="text-muted">
              · {p.status}
              {p.when ? ` · ${p.when}` : ''}
            </span>
            {p.externalUrl && (
              <>
                {' · '}
                <a className="text-sprout-600 underline" href={p.externalUrl}>
                  View post
                </a>
              </>
            )}
          </p>
          {p.errorMessage && <p className="text-sm text-danger">{p.errorMessage}</p>}
          {p.items.map((body, i) => (
            <p key={i} className="whitespace-pre-wrap rounded-sm bg-surface p-2 text-sm">
              {body}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
