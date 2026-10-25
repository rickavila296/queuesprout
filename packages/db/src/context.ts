import { and, eq, sql } from 'drizzle-orm';
import type { MemberRole } from '@queuesprout/shared';
import type { Database, Tx } from './client';
import { workspaceMembers, workspaces } from './schema';

declare const workspaceContextBrand: unique symbol;

/**
 * Proof that userId is a member of workspaceId with the given role. Only
 * resolveWorkspace() creates one, so a query cannot run against a workspace the
 * caller has not been checked against. RLS then checks again in the database.
 */
export interface WorkspaceContext {
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly role: MemberRole;
  readonly [workspaceContextBrand]: true;
}

async function setUser(tx: Tx, userId: string): Promise<void> {
  // Transaction-local (third argument true), so it can never leak to the next pooled query.
  await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
}

export interface DataAccess {
  /** Runs fn in a transaction scoped to the signed-in user (no workspace yet). */
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Checks membership and returns the context, or null when the user is not a member. */
  resolveWorkspace(userId: string, slug: string): Promise<WorkspaceContext | null>;
  /** Every tenant query in apps/web runs inside this wrapper. */
  withWorkspace<T>(ctx: WorkspaceContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export function createDataAccess(db: Database): DataAccess {
  const withUser: DataAccess['withUser'] = (userId, fn) =>
    db.transaction(async (tx) => {
      await setUser(tx, userId);
      return fn(tx);
    });

  return {
    withUser,

    async resolveWorkspace(userId, slug) {
      const rows = await withUser(userId, (tx) =>
        tx
          .select({
            workspaceId: workspaces.id,
            slug: workspaces.slug,
            role: workspaceMembers.role,
          })
          .from(workspaces)
          .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
          .where(and(eq(workspaces.slug, slug), eq(workspaceMembers.userId, userId)))
          .limit(1),
      );
      const row = rows[0];
      if (!row) return null;
      return {
        userId,
        workspaceId: row.workspaceId,
        workspaceSlug: row.slug,
        role: row.role,
      } as WorkspaceContext;
    },

    withWorkspace(ctx, fn) {
      return db.transaction(async (tx) => {
        await setUser(tx, ctx.userId);
        await tx.execute(sql`select set_config('app.workspace_id', ${ctx.workspaceId}, true)`);
        return fn(tx);
      });
    },
  };
}
