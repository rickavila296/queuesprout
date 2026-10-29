import type { Metadata } from 'next';
import { Logo } from '@queuesprout/ui';
import { requireUser } from '@/lib/session';
import { CreateWorkspaceForm } from './create-workspace-form';

export const metadata: Metadata = { title: 'Add a client' };

export default async function OnboardingPage() {
  const user = await requireUser('/onboarding');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <Logo />
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Add a client</h1>
        <p className="text-muted">
          Each client gets its own channels, posts, media and team. Signed in as {user.email}.
        </p>
      </div>
      <CreateWorkspaceForm />
    </main>
  );
}
