import { z } from 'zod';

/** Ordered from most to least privileged. Must match the member_role enum in Postgres. */
export const MEMBER_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof memberRoleSchema>;

/** Roles an admin can hand out in an invite. Ownership is never granted by invite. */
export const INVITABLE_ROLES = [
  'admin',
  'editor',
  'viewer',
] as const satisfies readonly MemberRole[];
export const invitableRoleSchema = z.enum(INVITABLE_ROLES);
export type InvitableRole = z.infer<typeof invitableRoleSchema>;
