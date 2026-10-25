import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import type { WorkspaceContext } from '@queuesprout/db';
export { safeNextPath } from '@queuesprout/core';
import { auth } from './auth';
import { dataAccess } from './db';

/** Current session, deduplicated per request. */
export const getSession = cache(async () => {
  // Read headers first: it marks the route dynamic before env() is touched at build time.
  const requestHeaders = await headers();
  return auth().api.getSession({ headers: requestHeaders });
});

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

/** Signed-in user, or a redirect to sign-in that comes back to `returnTo`. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    const query = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
    redirect(`/sign-in${query}` as `/sign-in`);
  }
  const { id, email, name, image } = session.user;
  return { id, email, name, image: image ?? null };
}

/** Membership-checked context for /w/[slug]. Non-members get a 404, not a hint it exists. */
export const requireWorkspace = cache(
  async (slug: string): Promise<{ user: SessionUser; ctx: WorkspaceContext }> => {
    const user = await requireUser(`/w/${slug}`);
    const ctx = await dataAccess().resolveWorkspace(user.id, slug);
    if (!ctx) notFound();
    return { user, ctx };
  },
);
