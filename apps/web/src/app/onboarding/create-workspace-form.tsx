'use client';

import { useActionState, useState, useSyncExternalStore } from 'react';
import { slugify } from '@queuesprout/core';
import { Button, FieldError, Input, Label } from '@queuesprout/ui';
import { createWorkspaceAction } from './actions';

const noopSubscribe = () => () => {};
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  // The browser's timezone; 'UTC' during server render.
  const timezone = useSyncExternalStore(noopSubscribe, browserTimezone, () => 'UTC');

  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={80}
          placeholder="Acme Coffee"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
          aria-invalid={errors?.name ? true : undefined}
        />
        <FieldError>{errors?.name}</FieldError>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">URL</Label>
        <div className="flex items-center gap-1 text-muted">
          <span className="font-mono text-sm">/w/</span>
          <Input
            id="slug"
            name="slug"
            required
            maxLength={48}
            className="font-mono"
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
            aria-invalid={errors?.slug ? true : undefined}
          />
        </div>
        <FieldError>{errors?.slug}</FieldError>
      </div>
      <input type="hidden" name="timezone" value={timezone} />
      <p className="text-sm text-muted">Timezone: {timezone}. You can change it later.</p>
      {state && !state.ok && !errors && <FieldError>{state.error}</FieldError>}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Creating…' : 'Create workspace'}
      </Button>
    </form>
  );
}
