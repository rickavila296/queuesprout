import type { Metadata } from 'next';
import Link from 'next/link';
import { getInvitePreview } from '@queuesprout/db';
import { buttonVariants, Card, Logo } from '@queuesprout/ui';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { hashToken } from '@/lib/tokens';
import { AcceptForm } from './accept-form';

export const metadata: Metadata = { title: 'Workspace invite', robots: { index: false } };

export default async function InvitePage({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  const [invite, session] = await Promise.all([
    getInvitePreview(db(), hashToken(token)),
    getSession(),
  ]);

  const usable = invite && !invite.accepted && invite.expiresAt > new Date();
  const signedInEmail = session?.user.email.toLowerCase();

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <Logo />
      {!usable ? (
        <Card className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold">This invite cannot be used</h1>
          <p className="text-muted">
            It has expired, was revoked, or was already accepted. Ask the person who invited you to
            send a new one.
          </p>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">Join {invite.workspaceName}</h1>
            <p className="text-muted">
              You were invited as <strong className="text-text">{invite.role}</strong> using{' '}
              {invite.email}.
            </p>
          </div>
          {!session ? (
            <Link
              href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}` as '/sign-in'}
              className={buttonVariants({ size: 'lg' })}
            >
              Sign in to accept
            </Link>
          ) : signedInEmail === invite.email.toLowerCase() ? (
            <AcceptForm token={token} />
          ) : (
            <p role="alert" className="text-danger">
              You are signed in as {session.user.email}. Sign out and sign in as {invite.email} to
              accept.
            </p>
          )}
        </Card>
      )}
    </main>
  );
}
