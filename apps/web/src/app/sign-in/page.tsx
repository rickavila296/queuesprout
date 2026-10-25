import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@queuesprout/ui';
import { enabledSocialProviders } from '@/lib/auth';
import { getSession, safeNextPath } from '@/lib/session';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  EXPIRED_TOKEN: 'That sign-in link has expired. Request a new one.',
  INVALID_TOKEN: 'That sign-in link is not valid any more. Request a new one.',
};

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : undefined);
  if (await getSession()) redirect(next as '/app');

  const errorCode = typeof params.error === 'string' ? params.error : undefined;
  const error = errorCode ? (ERRORS[errorCode] ?? 'Sign-in failed. Try again.') : undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <Logo />
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-muted">New here? Signing in creates your account.</p>
      </div>
      <SignInForm next={next} providers={enabledSocialProviders()} initialError={error} />
    </main>
  );
}
