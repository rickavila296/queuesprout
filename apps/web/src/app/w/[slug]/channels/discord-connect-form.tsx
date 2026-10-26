'use client';

import { useActionState, useState } from 'react';
import { Button, FieldError, Input, Label } from '@queuesprout/ui';
import { connectDiscordAction } from './actions';

export function DiscordConnectForm({ workspaceSlug }: { workspaceSlug: string }) {
  // Controlled, because React resets form fields after an action and a failed attempt
  // should keep what was typed.
  const [webhookUrl, setWebhookUrl] = useState('');
  const [label, setLabel] = useState('');
  const [state, action, pending] = useActionState(
    async (prev: Parameters<typeof connectDiscordAction>[0], formData: FormData) => {
      const result = await connectDiscordAction(prev, formData);
      // The webhook URL is a secret; once it is stored encrypted, clear it from the page.
      if (result?.ok) {
        setWebhookUrl('');
        setLabel('');
      }
      return result;
    },
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="discord-webhook">Webhook URL</Label>
          <Input
            id="discord-webhook"
            name="webhookUrl"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            type="password"
            placeholder="https://discord.com/api/webhooks/…"
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={errors?.webhookUrl ? true : undefined}
            aria-describedby="discord-webhook-help"
          />
          <FieldError>{errors?.webhookUrl}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="discord-label">Name (optional)</Label>
          <Input
            id="discord-label"
            name="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="#announcements"
            aria-invalid={errors?.label ? true : undefined}
          />
          <FieldError>{errors?.label}</FieldError>
        </div>
      </div>
      <p id="discord-webhook-help" className="text-sm text-muted">
        In Discord, open the channel&apos;s settings, then Integrations, Webhooks, New Webhook, and
        copy its URL. Anyone with the URL can post to the channel, so QueueSprout stores it
        encrypted. Deleting the webhook in Discord disconnects it.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Connecting…' : 'Connect Discord'}
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
