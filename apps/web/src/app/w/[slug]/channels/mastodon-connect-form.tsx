'use client';

import { useActionState, useState } from 'react';
import { Button, FieldError, Input, Label } from '@queuesprout/ui';
import { startMastodonConnectAction } from './actions';

export function MastodonConnectForm({ workspaceSlug }: { workspaceSlug: string }) {
  // Controlled, so a failed attempt keeps what was typed.
  const [instance, setInstance] = useState('');
  const [state, action, pending] = useActionState(startMastodonConnectAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mastodon-instance">Your server</Label>
        <Input
          id="mastodon-instance"
          name="instance"
          value={instance}
          onChange={(e) => setInstance(e.target.value)}
          placeholder="mastodon.social"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={errors?.instance ? true : undefined}
          aria-describedby="mastodon-help"
        />
        <FieldError>{errors?.instance}</FieldError>
      </div>
      <p id="mastodon-help" className="text-sm text-muted">
        The part after the second @ in your handle. You&apos;ll sign in on your server and approve
        QueueSprout there; your password never reaches QueueSprout.
      </p>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Opening your server…' : 'Connect Mastodon'}
        </Button>
      </div>
      <FieldError>{state && !state.ok && !state.fieldErrors ? state.error : undefined}</FieldError>
    </form>
  );
}
