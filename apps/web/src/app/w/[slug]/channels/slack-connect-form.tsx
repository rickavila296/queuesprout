'use client';

import { useActionState, useState } from 'react';
import { Button, FieldError, Input, Label } from '@queuesprout/ui';
import { connectSlackAction } from './actions';

export function SlackConnectForm({ workspaceSlug }: { workspaceSlug: string }) {
  // Controlled, because React resets form fields after an action and a failed attempt
  // should keep what was typed.
  const [channel, setChannel] = useState('');
  const [botToken, setBotToken] = useState('');
  const [state, action, pending] = useActionState(
    async (prev: Parameters<typeof connectSlackAction>[0], formData: FormData) => {
      const result = await connectSlackAction(prev, formData);
      // The bot token is a secret; once it is stored encrypted, clear it from the page.
      if (result?.ok) {
        setChannel('');
        setBotToken('');
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
          <Label htmlFor="slack-channel">Channel</Label>
          <Input
            id="slack-channel"
            name="channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="#announcements"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={errors?.channel ? true : undefined}
          />
          <FieldError>{errors?.channel}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slack-token">Bot token</Label>
          <Input
            id="slack-token"
            name="botToken"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            type="password"
            placeholder="xoxb-…"
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={errors?.botToken ? true : undefined}
            aria-describedby="slack-token-help"
          />
          <FieldError>{errors?.botToken}</FieldError>
        </div>
      </div>
      <p id="slack-token-help" className="text-sm text-muted">
        At api.slack.com/apps, create an app, add the chat:write, channels:read and groups:read bot
        scopes, install it to your workspace and copy the Bot User OAuth Token. Then type /invite in
        the channel and pick the app. QueueSprout stores the token encrypted.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Connecting…' : 'Connect Slack'}
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
