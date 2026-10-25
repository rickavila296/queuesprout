import type { Metadata } from 'next';
import { Logo } from '@queuesprout/ui';
import { requireUser } from '@/lib/session';
import { CreateWorkspaceForm } from './create-workspace-form';

export const metadata: Metadata = { title: 'Create a workspace' };

export default async function OnboardingPage() {
  const user = await requireUser('/onboarding');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <Logo />
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Create a workspace</h1>
        <p className="text-muted">
          A workspace holds one brand or client: its channels, posts and team. Signed in as{' '}
          {user.email}.
        </p>
      </div>
      <CreateWorkspaceForm />
    </main>
  );
}
