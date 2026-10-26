import type { Metadata } from 'next';
import { canManageMembers } from '@queuesprout/auth';
import { getWorkspace, listChannels, type ChannelSummary } from '@queuesprout/db';
import { Badge, Card } from '@queuesprout/ui';
import { ConfirmButton } from '@/components/confirm-button';
import { CONNECT_RESULTS, type ConnectResult } from '@/lib/connect';
import { dataAccess } from '@/lib/db';
import { providerLabel } from '@/lib/providers';
import { workspaceIsMock } from '@/lib/publish-mode';
import { requireWorkspace } from '@/lib/session';
import { removeChannelAction } from './actions';
import { BlueskyConnectForm } from './bluesky-connect-form';
import { DiscordConnectForm } from './discord-connect-form';
import { DemoChannelForm } from './demo-channel-form';
import { MastodonConnectForm } from './mastodon-connect-form';
import { TelegramConnectForm } from './telegram-connect-form';
import { ProviderMark } from './provider-mark';

export const metadata: Metadata = { title: 'Channels' };

function health(c: ChannelSummary): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (c.accountStatus === 'needs_reauth') return { label: 'Needs reconnect', tone: 'danger' };
  if (c.accountStatus === 'revoked') return { label: 'Revoked', tone: 'danger' };
  if (c.channelStatus === 'rate_limited') return { label: 'Rate limited', tone: 'warning' };
  if (c.channelStatus === 'disabled') return { label: 'Disabled', tone: 'warning' };
  if (c.channelStatus === 'target_missing') return { label: 'Not found', tone: 'danger' };
  return { label: 'Active', tone: 'success' };
}

export default async function ChannelsPage({
  params,
  searchParams,
}: PageProps<'/w/[slug]/channels'>) {
  const { slug } = await params;
  const { connect } = await searchParams;
  // Only known codes are shown, so a crafted link cannot put its own text on the page.
  const result =
    typeof connect === 'string' && Object.hasOwn(CONNECT_RESULTS, connect)
      ? (connect as ConnectResult)
      : null;
  const { ctx } = await requireWorkspace(slug);
  // Same rule as members: admins manage channels.
  const manage = canManageMembers(ctx);

  const { channels, workspace } = await dataAccess().withWorkspace(ctx, async (tx) => ({
    channels: await listChannels(tx, ctx.workspaceId),
    workspace: await getWorkspace(tx, ctx.workspaceId),
  }));
  const mock = workspace ? workspaceIsMock(workspace) : false;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Channels</h1>
        <p className="text-muted">Where your posts go.</p>
      </div>

      {manage && mock && (
        <Card className="flex flex-col gap-3">
          <div>
            <h2 className="font-medium">Add a demo channel</h2>
            <p className="text-sm text-muted">
              This workspace is in sandbox mode: posts run through the whole pipeline but never
              leave QueueSprout. Demo channels need no sign-in.
            </p>
          </div>
          <DemoChannelForm workspaceSlug={slug} />
        </Card>
      )}
      {result && (
        <p
          role="status"
          className={
            result === 'connected'
              ? 'rounded-md border border-border bg-surface px-3 py-2 text-sm text-sprout-600'
              : 'rounded-md border border-border bg-surface px-3 py-2 text-sm text-danger'
          }
        >
          {CONNECT_RESULTS[result]}
        </p>
      )}

      {manage && workspace && !workspace.isSandbox && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ProviderMark provider="bluesky" />
            <h2 className="font-medium">Connect Bluesky</h2>
          </div>
          {mock && (
            <p className="text-sm text-muted">
              Publishing is in mock mode on this server, so posts to this account are simulated and
              never reach Bluesky.
            </p>
          )}
          <BlueskyConnectForm workspaceSlug={slug} />
        </Card>
      )}
      {manage && workspace && !workspace.isSandbox && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ProviderMark provider="mastodon" />
            <h2 className="font-medium">Connect Mastodon</h2>
          </div>
          <MastodonConnectForm workspaceSlug={slug} />
        </Card>
      )}
      {manage && workspace && !workspace.isSandbox && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ProviderMark provider="discord" />
            <h2 className="font-medium">Connect a Discord channel</h2>
          </div>
          <DiscordConnectForm workspaceSlug={slug} />
        </Card>
      )}
      {manage && workspace && !workspace.isSandbox && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ProviderMark provider="telegram" />
            <h2 className="font-medium">Connect a Telegram channel</h2>
          </div>
          <TelegramConnectForm workspaceSlug={slug} />
        </Card>
      )}

      <section aria-labelledby="channels-heading" className="flex flex-col gap-2">
        <h2 id="channels-heading" className="font-medium">
          {channels.length} {channels.length === 1 ? 'channel' : 'channels'}
        </h2>
        {channels.length === 0 ? (
          <p className="text-muted">No channels yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {channels.map((c) => {
              const h = health(c);
              return (
                <li key={c.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
                  <ProviderMark provider={c.provider} className="size-7 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{c.name}</p>
                    <p className="truncate text-sm text-muted">
                      {providerLabel(c.provider)}
                      {c.handle ? ` · ${c.handle}` : ''}
                    </p>
                  </div>
                  <Badge tone={h.tone}>{h.label}</Badge>
                  {manage && (
                    <form action={removeChannelAction}>
                      <input type="hidden" name="workspaceSlug" value={slug} />
                      <input type="hidden" name="channelId" value={c.id} />
                      <ConfirmButton
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${c.name}`}
                        confirmText={`Remove ${c.name}? Its posts, published or not, are deleted from QueueSprout too.`}
                      >
                        Remove
                      </ConfirmButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
