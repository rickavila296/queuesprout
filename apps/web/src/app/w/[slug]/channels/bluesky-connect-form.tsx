'use client';

import { useActionState, useState } from 'react';
import { Button, FieldError, Input, Label } from '@queuesprout/ui';
import { connectBlueskyAction } from './actions';

export function BlueskyConnectForm({ workspaceSlug }: { workspaceSlug: string }) {
  // Controlled, because React resets form fields after an action and a failed attempt
  // should keep what was typed.
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [serviceUrl, setServiceUrl] = useState('');
  const [state, action, pending] = useActionState(
    async (prev: Parameters<typeof connectBlueskyAction>[0], formData: FormData) => {
      const result = await connectBlueskyAction(prev, formData);
      // Once connected, the app password has done its job; don't leave it in the page.
      if (result?.ok) {
        setHandle('');
        setPassword('');
        setServiceUrl('');
      }
      return result;
    },
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bsky-handle">Handle</Label>
          <Input
            id="bsky-handle"
            name="handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="alice.bsky.social"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={errors?.handle ? true : undefined}
          />
          <FieldError>{errors?.handle}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bsky-password">App password</Label>
          <Input
            id="bsky-password"
            name="appPassword"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="abcd-efgh-ijkl-mnop"
            autoComplete="off"
            required
            aria-invalid={errors?.appPassword ? true : undefined}
            aria-describedby="bsky-password-help"
          />
          <FieldError>{errors?.appPassword}</FieldError>
        </div>
      </div>
      <p id="bsky-password-help" className="text-sm text-muted">
        Create one in Bluesky under Settings, Privacy and security, App passwords. Never use your
        account password. QueueSprout keeps only the encrypted session, and you can revoke the app
        password at any time.
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Self-hosted server</summary>
        <div className="mt-2 flex flex-col gap-1.5">
          <Label htmlFor="bsky-service">Server address</Label>
          <Input
            id="bsky-service"
            name="serviceUrl"
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            type="url"
            placeholder="https://bsky.social"
            aria-invalid={errors?.serviceUrl ? true : undefined}
          />
          <FieldError>{errors?.serviceUrl}</FieldError>
        </div>
      </details>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Connecting…' : 'Connect Bluesky'}
        </Button>
        {state?.ok && (
          <p role="status" className="text-sm text-sprout-600">
            Connected {state.data.name}.
          </p>
        )}
      </div>
      <FieldError>{state && !state.ok && !state.fieldErrors ? state.error : undefined}</FieldError>
    </form>
  );
}
