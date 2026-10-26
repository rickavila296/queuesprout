import type { Metadata } from 'next';
import { canManageMembers } from '@queuesprout/auth';
import { listMembers, listOpenInvites } from '@queuesprout/db';
import { Badge, Button, Card } from '@queuesprout/ui';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { revokeInviteAction } from './actions';
import { InviteForm } from './invite-form';
import { MemberControls } from './member-controls';

export const metadata: Metadata = { title: 'Members' };

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export default async function MembersPage({ params }: PageProps<'/w/[slug]/settings/members'>) {
  const { slug } = await params;
  const { user, ctx } = await requireWorkspace(slug);
  const manage = canManageMembers(ctx);

  const { members, invites } = await dataAccess().withWorkspace(ctx, async (tx) => ({
    members: await listMembers(tx, ctx.workspaceId),
    invites: manage ? await listOpenInvites(tx, ctx.workspaceId) : [],
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Members</h1>
        <p className="text-muted">Who can work in this workspace, and what they can do.</p>
      </div>

      {manage && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-medium">Invite a teammate</h2>
          <InviteForm workspaceSlug={slug} />
        </Card>
      )}

      <section aria-labelledby="members-heading" className="flex flex-col gap-2">
        <h2 id="members-heading" className="font-medium">
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </h2>
        <ul className="divide-y divide-border rounded-md border border-border">
          {members.map((m) => (
            <li key={m.userId} className="flex h-12 items-center gap-3 px-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-surface-hover text-sm font-medium">
                {(m.displayName || m.email).slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  {m.displayName}
                  {m.userId === user.id && <span className="text-muted"> (you)</span>}
                </p>
                <p className="truncate text-sm text-muted">{m.email}</p>
              </div>
              {manage && m.role !== 'owner' && m.userId !== user.id ? (
                <MemberControls
                  workspaceSlug={slug}
                  userId={m.userId}
                  name={m.displayName || m.email}
                  role={m.role}
                />
              ) : (
                <Badge tone={m.role === 'owner' ? 'success' : 'neutral'}>{m.role}</Badge>
              )}
            </li>
          ))}
        </ul>
      </section>

      {manage && invites.length > 0 && (
        <section aria-labelledby="invites-heading" className="flex flex-col gap-2">
          <h2 id="invites-heading" className="font-medium">
            Pending invites
          </h2>
          <ul className="divide-y divide-border rounded-md border border-border">
            {invites.map((i) => (
              <li key={i.id} className="flex h-12 items-center gap-3 px-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{i.email}</p>
                  <p className="text-sm text-muted">Expires {dateFormat.format(i.expiresAt)}</p>
                </div>
                <Badge>{i.role}</Badge>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="workspaceSlug" value={slug} />
                  <input type="hidden" name="inviteId" value={i.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Revoke
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
