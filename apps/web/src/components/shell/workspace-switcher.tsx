'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';

export interface SwitcherWorkspace {
  name: string;
  slug: string;
}

/** Client switcher on the pine shell. A workspace is one client; only the words say "client". */
export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: SwitcherWorkspace;
  workspaces: SwitcherWorkspace[];
}) {
  return (
    <details className="group relative">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-shell-border bg-shell-hover px-2 text-shell-strong [&::-webkit-details-marker]:hidden">
        <span className="sr-only">Switch client. Current client:</span>
        <span
          className="flex size-5 items-center justify-center rounded-sm bg-accent text-xs font-semibold text-on-accent"
          aria-hidden="true"
        >
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="flex-1 truncate font-medium">{current.name}</span>
        <ChevronsUpDown className="size-3.5 text-shell-text" aria-hidden="true" />
      </summary>
      <div className="absolute inset-x-0 top-10 z-30 rounded-md border border-border bg-surface-raised p-1 text-text shadow-md">
        <ul aria-label="Clients">
          {workspaces.map((w) => (
            <li key={w.slug}>
              <Link
                href={`/w/${w.slug}` as '/'}
                className="flex h-8 items-center gap-2 rounded-sm px-2 hover:bg-surface-hover"
                aria-current={w.slug === current.slug ? 'true' : undefined}
              >
                <span className="flex-1 truncate">{w.name}</span>
                {w.slug === current.slug && (
                  <Check className="size-3.5 text-success" aria-label="Current" />
                )}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/onboarding"
          className="mt-1 flex h-8 items-center gap-2 rounded-sm border-t border-border px-2 text-muted hover:bg-surface-hover"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New client
        </Link>
      </div>
    </details>
  );
}
