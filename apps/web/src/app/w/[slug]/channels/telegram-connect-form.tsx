'use client';

import { useActionState, useState } from 'react';
import { Button, FieldError, Input, Label } from '@queuesprout/ui';
import { connectTelegramAction } from './actions';

export function TelegramConnectForm({ workspaceSlug }: { workspaceSlug: string }) {
  // Controlled, because React resets form fields after an action and a failed attempt
  // should keep what was typed.
  const [chat, setChat] = useState('');
  const [botToken, setBotToken] = useState('');
  const [state, action, pending] = useActionState(
    async (prev: Parameters<typeof connectTelegramAction>[0], formData: FormData) => {
      const result = await connectTelegramAction(prev, formData);
      // The bot token is a secret; once it is stored encrypted, clear it from the page.
      if (result?.ok) {
        setChat('');
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
          <Label htmlFor="telegram-chat">Channel or group</Label>
          <Input
            id="telegram-chat"
            name="chat"
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            placeholder="@mychannel"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={errors?.chat ? true : undefined}
          />
          <FieldError>{errors?.chat}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="telegram-token">Bot token</Label>
          <Input
            id="telegram-token"
            name="botToken"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            type="password"
            placeholder="123456789:AAH…"
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={errors?.botToken ? true : undefined}
            aria-describedby="telegram-token-help"
          />
          <FieldError>{errors?.botToken}</FieldError>
        </div>
      </div>
      <p id="telegram-token-help" className="text-sm text-muted">
        Message @BotFather in Telegram, send /newbot and copy the token it gives you. Then add the
        bot to your channel as an admin that can post messages. For a private channel, enter its
        numeric id, which starts with -100. QueueSprout stores the token encrypted.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Connecting…' : 'Connect Telegram'}
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
