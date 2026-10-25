import { hasRole } from '@queuesprout/core';
import type { WorkspaceContext } from '@queuesprout/db';
import type { MemberRole } from '@queuesprout/shared';

export class ForbiddenError extends Error {
  constructor(public readonly requiredRole: MemberRole) {
    super(`This action needs the ${requiredRole} role or higher.`);
    this.name = 'ForbiddenError';
  }
}

/** Throws ForbiddenError unless the member's role satisfies minRole. */
export function assertRole(ctx: Pick<WorkspaceContext, 'role'>, minRole: MemberRole): void {
  if (!hasRole(ctx.role, minRole)) throw new ForbiddenError(minRole);
}

export function canManageMembers(ctx: Pick<WorkspaceContext, 'role'>): boolean {
  return hasRole(ctx.role, 'admin');
}
