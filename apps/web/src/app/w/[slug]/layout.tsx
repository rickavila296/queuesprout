import { listMyWorkspaces } from '@queuesprout/db';
import { AppShell } from '@/components/shell/app-shell';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';

export default async function WorkspaceLayout({ children, params }: LayoutProps<'/w/[slug]'>) {
  const { slug } = await params;
  const { user } = await requireWorkspace(slug);
  const workspaces = await dataAccess().withUser(user.id, (tx) => listMyWorkspaces(tx, user.id));
  const current = workspaces.find((w) => w.slug === slug);

  return (
    <AppShell
      workspace={{ name: current?.name ?? slug, slug }}
      workspaces={workspaces.map(({ name, slug: s }) => ({ name, slug: s }))}
      user={{ name: user.name, email: user.email }}
    >
      {children}
    </AppShell>
  );
}
