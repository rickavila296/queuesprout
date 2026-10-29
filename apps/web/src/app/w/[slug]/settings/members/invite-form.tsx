'use client';

import { useActionState, useEffect, useRef } from 'react';
import { INVITABLE_ROLES } from '@queuesprout/shared';
import { Button, FieldError, Input, Label, Select } from '@queuesprout/ui';
import { inviteMemberAction } from './actions';
import { ROLE_LABEL } from './roles';

export function InviteForm({ workspaceSlug }: { workspaceSlug: string }) {
  const [state, action, pending] = useActionState(inviteMemberAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="teammate@example.com"
            aria-invalid={errors?.email ? true : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:w-36">
          <Label htmlFor="invite-role">Role</Label>
          <Select id="invite-role" name="role" defaultValue="editor">
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send invite'}
        </Button>
      </div>
      <p className="text-sm text-muted">
        Admins manage members and channels. Editors create and schedule posts. Viewers read only.
        Inviting someone who is already a member changes their role.
      </p>
      <FieldError>{errors?.email ?? (state && !state.ok ? state.error : undefined)}</FieldError>
      {state?.ok && (
        <p role="status" className="text-sm text-success">
          Invite sent to {state.data.email}.
        </p>
      )}
    </form>
  );
}
