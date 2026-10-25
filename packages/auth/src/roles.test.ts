import { describe, expect, it } from 'vitest';
import { ForbiddenError, assertRole, canManageMembers } from './roles';

describe('assertRole', () => {
  it('passes for a sufficient role', () => {
    expect(() => assertRole({ role: 'admin' }, 'editor')).not.toThrow();
  });
  it('throws ForbiddenError for an insufficient role', () => {
    expect(() => assertRole({ role: 'viewer' }, 'admin')).toThrow(ForbiddenError);
  });
  it('lets only admins and owners manage members', () => {
    expect(canManageMembers({ role: 'owner' })).toBe(true);
    expect(canManageMembers({ role: 'editor' })).toBe(false);
  });
});
