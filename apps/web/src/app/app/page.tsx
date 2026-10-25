import { redirect } from 'next/navigation';
import { listMyWorkspaces } from '@queuesprout/db';
import { dataAccess } from '@/lib/db';
import { requireUser } from '@/lib/session';

/** Post-sign-in landing: the first workspace, or onboarding when there is none. */
export default async function AppEntry() {
  const user = await requireUser('/app');
  const workspaces = await dataAccess().withUser(user.id, (tx) => listMyWorkspaces(tx, user.id));
  const first = workspaces[0];
  if (!first) redirect('/onboarding');
  redirect(`/w/${first.slug}`);
}
