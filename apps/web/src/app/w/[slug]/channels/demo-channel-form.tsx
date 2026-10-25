'use client';

import { useActionState } from 'react';
import { PROVIDER_IDS } from '@queuesprout/shared';
import { Button, FieldError } from '@queuesprout/ui';
import { PROVIDER_LABELS } from '@/lib/providers';
import { connectDemoChannelAction } from './actions';
import { ProviderMark } from './provider-mark';

export function DemoChannelForm({ workspaceSlug }: { workspaceSlug: string }) {
  const [state, action, pending] = useActionState(connectDemoChannelAction, null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {PROVIDER_IDS.map((id) => (
          <li key={id}>
            <Button
              type="submit"
              name="provider"
              value={id}
              variant="secondary"
              className="w-full justify-start"
              disabled={pending}
            >
              <ProviderMark provider={id} />
              {PROVIDER_LABELS[id]}
            </Button>
          </li>
        ))}
      </ul>
      <FieldError>{state && !state.ok ? state.error : undefined}</FieldError>
      {state?.ok && (
        <p role="status" className="text-sm text-sprout-600">
          Added {state.data.name}.
        </p>
      )}
    </form>
  );
}
