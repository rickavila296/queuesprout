'use client';

import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { authClient } from '@queuesprout/auth/client';
import { Button, FieldError, Input, Label } from '@queuesprout/ui';

interface Props {
  next: string;
  providers: { google: boolean; github: boolean };
  initialError?: string | undefined;
}

const emailSchema = z.email();

export function SignInForm({ next, providers, initialError }: Props) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState(initialError);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setError('Enter a valid email.');
      return;
    }
    setError(undefined);
    setStatus('sending');
    const { error: sendError } = await authClient.signIn.magicLink({
      email: parsed.data,
      callbackURL: next,
      errorCallbackURL: '/sign-in',
    });
    if (sendError) {
      setStatus('idle');
      setError(
        sendError.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : 'Could not send the link. Try again.',
      );
      return;
    }
    setStatus('sent');
  }

  async function social(provider: 'google' | 'github') {
    setError(undefined);
    const { error: socialError } = await authClient.signIn.social({
      provider,
      callbackURL: next,
      errorCallbackURL: '/sign-in',
    });
    if (socialError) setError('Could not start sign-in. Try again.');
  }

  if (status === 'sent') {
    return (
      <div role="status" className="rounded-md border border-border bg-surface p-4">
        <p className="font-medium">Check your email</p>
        <p className="text-muted">
          We sent a sign-in link to {email.trim()}. It expires in 15 minutes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          required
        />
        <FieldError>{error}</FieldError>
        <Button type="submit" size="lg" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
      </form>
      {(providers.google || providers.github) && (
        <>
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="flex flex-col gap-2">
            {providers.google && (
              <Button variant="secondary" size="lg" onClick={() => void social('google')}>
                Continue with Google
              </Button>
            )}
            {providers.github && (
              <Button variant="secondary" size="lg" onClick={() => void social('github')}>
                Continue with GitHub
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
