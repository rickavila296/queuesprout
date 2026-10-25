import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { CreateWorkspaceInput, InvitableRole, MemberRole } from '@queuesprout/shared';
import type { Queryable, Tx } from '../client';
import { PG_RAISE_EXCEPTION, PG_UNIQUE_VIOLATION, findPgError } from '../errors';
import { profiles, user, workspaceInvites, workspaceMembers, workspaces } from '../schema';

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
}

/** Workspaces the current user (app.user_id) belongs to. Run inside withUser(). */
export async function listMyWorkspaces(tx: Tx, userId: string): Promise<WorkspaceSummary[]> {
  return tx
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.name));
}

export async function getWorkspace(tx: Tx, workspaceId: string) {
  const rows = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Creates the workspace and the owner membership atomically (app.create_workspace).
 * Slugs are global but RLS hides other tenants, so the unique index is the only
 * reliable "taken" check. Call it as the last statement of its transaction.
 */
export async function createWorkspace(
  tx: Tx,
  input: CreateWorkspaceInput,
): Promise<{ ok: true; id: string } | { ok: false; error: 'slug_taken' }> {
  try {
    const result = await tx.execute<{ id: string }>(
      sql`select app.create_workspace(${input.name}, ${input.slug}, ${input.timezone}) as id`,
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('create_workspace returned no id');
    return { ok: true, id };
  } catch (error) {
    if (findPgError(error)?.code === PG_UNIQUE_VIOLATION) return { ok: false, error: 'slug_taken' };
    throw error;
  }
}

export interface MemberRow {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: MemberRole;
  joinedAt: Date;
}

export async function listMembers(tx: Tx, workspaceId: string): Promise<MemberRow[]> {
  return tx
    .select({
      userId: workspaceMembers.userId,
      displayName: profiles.displayName,
      email: user.email,
      avatarUrl: profiles.avatarUrl,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
}

export interface InviteRow {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
  createdAt: Date;
}

export async function listOpenInvites(tx: Tx, workspaceId: string): Promise<InviteRow[]> {
  return tx
    .select({
      id: workspaceInvites.id,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      expiresAt: workspaceInvites.expiresAt,
      createdAt: workspaceInvites.createdAt,
    })
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.workspaceId, workspaceId), isNull(workspaceInvites.acceptedAt)))
    .orderBy(desc(workspaceInvites.createdAt));
}

export interface CreateInviteInput {
  workspaceId: string;
  invitedBy: string;
  email: string;
  role: InvitableRole;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Creates an invite, replacing any open invite for the same email so a resend
 * issues a fresh link and the old one stops working.
 */
export async function createInvite(tx: Tx, input: CreateInviteInput): Promise<string> {
  await tx
    .delete(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, input.workspaceId),
        sql`lower(${workspaceInvites.email}) = lower(${input.email})`,
        isNull(workspaceInvites.acceptedAt),
      ),
    );
  const rows = await tx
    .insert(workspaceInvites)
    .values({
      workspaceId: input.workspaceId,
      invitedBy: input.invitedBy,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    })
    .returning({ id: workspaceInvites.id });
  const id = rows[0]?.id;
  if (!id) throw new Error('invite insert returned no id');
  return id;
}

export async function revokeInvite(
  tx: Tx,
  workspaceId: string,
  inviteId: string,
): Promise<boolean> {
  const rows = await tx
    .delete(workspaceInvites)
    .where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.workspaceId, workspaceId)))
    .returning({ id: workspaceInvites.id });
  return rows.length > 0;
}

export interface InvitePreview {
  workspaceName: string;
  workspaceSlug: string;
  role: MemberRole;
  email: string;
  expiresAt: Date;
  accepted: boolean;
}

export async function getInvitePreview(
  tx: Queryable,
  tokenHash: string,
): Promise<InvitePreview | null> {
  const result = await tx.execute<{
    workspace_name: string;
    workspace_slug: string;
    role: MemberRole;
    email: string;
    expires_at: string | Date;
    accepted: boolean;
  }>(sql`select * from app.invite_preview(${tokenHash})`);
  const row = result.rows[0];
  if (!row) return null;
  return {
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    role: row.role,
    email: row.email,
    expiresAt: new Date(row.expires_at),
    accepted: row.accepted,
  };
}

export type AcceptInviteError = 'invite_invalid' | 'invite_email_mismatch';

/**
 * Accepts the invite for the current user and returns the workspace slug.
 * Call it as the only statement of its transaction: a failed accept aborts it.
 */
export async function acceptInvite(
  tx: Tx,
  tokenHash: string,
): Promise<{ ok: true; workspaceSlug: string } | { ok: false; error: AcceptInviteError }> {
  let workspaceId: string | undefined;
  try {
    const result = await tx.execute<{ id: string }>(
      sql`select app.accept_invite(${tokenHash}) as id`,
    );
    workspaceId = result.rows[0]?.id;
  } catch (error) {
    const pgError = findPgError(error);
    if (pgError?.code === PG_RAISE_EXCEPTION) {
      if (pgError.message.includes('invite_email_mismatch')) {
        return { ok: false, error: 'invite_email_mismatch' };
      }
      if (pgError.message.includes('invite_invalid')) return { ok: false, error: 'invite_invalid' };
    }
    throw error;
  }
  if (!workspaceId) return { ok: false, error: 'invite_invalid' };
  // The user is a member now, so RLS lets them read the workspace.
  const workspace = await getWorkspace(tx, workspaceId);
  if (!workspace) return { ok: false, error: 'invite_invalid' };
  return { ok: true, workspaceSlug: workspace.slug };
}
