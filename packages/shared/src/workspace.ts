import { z } from 'zod';
import { invitableRoleSchema } from './roles';

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

/** Slugs that would collide with top-level app routes. */
export const RESERVED_SLUGS = new Set([
  'api',
  'app',
  'admin',
  'auth',
  'invite',
  'mock',
  'new',
  'onboarding',
  'settings',
  'sign-in',
  'sign-up',
  'w',
]);

export const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, 'Use 1-48 lowercase letters, numbers or hyphens.')
  .refine((s) => !RESERVED_SLUGS.has(s), 'That name is reserved. Try another.');

export const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone.');

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  slug: workspaceSlugSchema,
  timezone: timezoneSchema.default('UTC'),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const inviteMemberSchema = z.object({
  workspaceSlug: workspaceSlugSchema,
  email: z.email('Enter a valid email.').trim().toLowerCase(),
  role: invitableRoleSchema,
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const INVITE_TTL_DAYS = 7;
