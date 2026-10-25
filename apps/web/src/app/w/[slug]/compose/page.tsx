import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasRole } from '@queuesprout/core';
import { getWorkspace, listChannels } from '@queuesprout/db';
import { Composer } from '@/components/composer/composer';
import { toComposerChannels } from '@/components/composer/load';
import { defaultScheduleWall } from '@/lib/compose';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';

export const metadata: Metadata = { title: 'New post' };

export default async function ComposePage({ params }: PageProps<'/w/[slug]/compose'>) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  if (!hasRole(ctx.role, 'editor')) notFound();

  const { workspace, channels } = await dataAccess().withWorkspace(ctx, async (tx) => ({
    workspace: await getWorkspace(tx, ctx.workspaceId),
    channels: await listChannels(tx, ctx.workspaceId),
  }));
  if (!workspace) notFound();
  const composerChannels = toComposerChannels(channels);
  const usable = composerChannels.filter((c) => c.unavailable === null);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-xl font-semibold">New post</h1>
      <Composer
        workspaceSlug={slug}
        timezone={workspace.timezone}
        channels={composerChannels}
        initial={{
          baseItems: [''],
          // One usable channel is picked for you; with several, you choose.
          picks: usable.length === 1 && usable[0] ? [{ channelId: usable[0].id, items: null }] : [],
          frozen: [],
          mode: 'schedule',
          scheduledAt: defaultScheduleWall(new Date(), workspace.timezone),
        }}
      />
    </div>
  );
}
