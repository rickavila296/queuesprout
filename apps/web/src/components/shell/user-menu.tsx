'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@queuesprout/auth/client';
import { Button } from '@queuesprout/ui';

export function UserMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const initial = (user.name || user.email).slice(0, 1).toUpperCase();

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.push('/sign-in');
    router.refresh();
  }

  return (
    <details className="relative">
      <summary
        className="flex size-8 cursor-pointer list-none items-center justify-center rounded-full bg-surface-hover text-sm font-medium [&::-webkit-details-marker]:hidden"
        aria-label="Account menu"
      >
        {initial}
      </summary>
      <div className="absolute right-0 top-10 z-30 w-56 rounded-md border border-border bg-bg p-1 shadow-sm">
        <div className="px-2 py-1.5">
          <p className="truncate font-medium">{user.name || user.email}</p>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => void signOut()}
          disabled={pending}
        >
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </details>
  );
}
