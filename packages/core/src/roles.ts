import { MEMBER_ROLES, type MemberRole } from '@queuesprout/shared';

/**
 * Mirrors app.has_role() in Postgres: a member satisfies minRole when their role
 * is at least as privileged. The database check is the one that counts; this one
 * lets the UI hide actions the user cannot take.
 */
export function hasRole(role: MemberRole, minRole: MemberRole): boolean {
  return MEMBER_ROLES.indexOf(role) <= MEMBER_ROLES.indexOf(minRole);
}

/** Admins invite anyone below owner; editors and viewers cannot invite. */
export function canInviteAs(inviter: MemberRole, invitedRole: MemberRole): boolean {
  return hasRole(inviter, 'admin') && invitedRole !== 'owner';
}
