'use client';

import { useActionState } from 'react';
import { Button, FieldError } from '@queuesprout/ui';
import { acceptInviteAction } from './actions';

export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction.bind(null, token), null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Joining…' : 'Accept invite'}
      </Button>
      <FieldError>{state && !state.ok ? state.error : undefined}</FieldError>
    </form>
  );
}
