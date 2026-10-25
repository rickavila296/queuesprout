import { describe, expect, it } from 'vitest';
import type { MemberRole } from '@queuesprout/shared';
import { canInviteAs, hasRole } from './roles';

describe('hasRole', () => {
  const cases: [MemberRole, MemberRole, boolean][] = [
    ['owner', 'owner', true],
    ['owner', 'viewer', true],
    ['admin', 'owner', false],
    ['admin', 'admin', true],
    ['editor', 'admin', false],
    ['editor', 'editor', true],
    ['viewer', 'editor', false],
    ['viewer', 'viewer', true],
  ];
  it.each(cases)('%s satisfies %s: %s', (role, min, expected) => {
    expect(hasRole(role, min)).toBe(expected);
  });
});

describe('canInviteAs', () => {
  it('lets admins and owners invite below owner', () => {
    expect(canInviteAs('owner', 'admin')).toBe(true);
    expect(canInviteAs('admin', 'viewer')).toBe(true);
  });
  it('never grants ownership by invite', () => {
    expect(canInviteAs('owner', 'owner')).toBe(false);
  });
  it('blocks editors and viewers', () => {
    expect(canInviteAs('editor', 'viewer')).toBe(false);
    expect(canInviteAs('viewer', 'viewer')).toBe(false);
  });
});
