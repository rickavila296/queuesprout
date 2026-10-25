'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';

export interface SwitcherWorkspace {
  name: string;
  slug: string;
}

export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: SwitcherWorkspace;
  workspaces: SwitcherWorkspace[];
}) {
  return (
    <details className="group relative">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-bg px-2 [&::-webkit-details-marker]:hidden">
        <span className="flex size-5 items-center justify-center rounded-sm bg-sprout-100 text-xs font-semibold text-sprout-600">
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="flex-1 truncate">{current.name}</span>
        <ChevronsUpDown className="size-3.5 text-muted" aria-hidden="true" />
      </summary>
      <div className="absolute inset-x-0 top-9 z-30 rounded-md border border-border bg-bg p-1 shadow-sm">
        <ul>
          {workspaces.map((w) => (
            <li key={w.slug}>
              <Link
                href={`/w/${w.slug}` as '/'}
                className="flex h-8 items-center gap-2 rounded-sm px-2 hover:bg-surface-hover"
              >
                <span className="flex-1 truncate">{w.name}</span>
                {w.slug === current.slug && (
                  <Check className="size-3.5 text-sprout-600" aria-label="Current" />
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
          New workspace
        </Link>
      </div>
    </details>
  );
}
