'use client';

import { INVITABLE_ROLES, type InvitableRole } from '@queuesprout/shared';
import { Select } from '@queuesprout/ui';
import { ConfirmButton } from '@/components/confirm-button';
import { changeMemberRoleAction, removeMemberAction } from './actions';
import { ROLE_LABEL } from './roles';

/** Role picker and Remove button on a member row; admins see them on every row but the owner's and their own. */
export function MemberControls({
  workspaceSlug,
  userId,
  name,
  role,
}: {
  workspaceSlug: string;
  userId: string;
  name: string;
  role: InvitableRole;
}) {
  return (
    <div className="flex items-center gap-2">
      <form action={changeMemberRoleAction}>
        <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
        <input type="hidden" name="userId" value={userId} />
        <Select
          name="role"
          aria-label={`Role for ${name}`}
          defaultValue={role}
          className="w-28"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {INVITABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </form>
      <form action={removeMemberAction}>
        <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
        <input type="hidden" name="userId" value={userId} />
        <ConfirmButton
          variant="ghost"
          size="sm"
          confirmText={`Remove ${name} from this workspace? They lose access right away.`}
        >
          Remove
        </ConfirmButton>
      </form>
    </div>
  );
}
