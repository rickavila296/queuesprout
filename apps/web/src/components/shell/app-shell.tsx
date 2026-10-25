'use client';

import { CalendarDays, Image as ImageIcon, Menu, Radio, Settings, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Badge, Button, cn, Logo } from '@queuesprout/ui';
import { ThemeToggle } from '../theme-toggle';
import { UserMenu } from './user-menu';
import { WorkspaceSwitcher, type SwitcherWorkspace } from './workspace-switcher';

interface NavItem {
  label: string;
  href: string | null;
  icon: typeof CalendarDays;
  soon?: string;
}

interface Props {
  workspace: { name: string; slug: string };
  workspaces: SwitcherWorkspace[];
  user: { name: string; email: string };
  children: ReactNode;
}

export function AppShell({ workspace, workspaces, user, children }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const base = `/w/${workspace.slug}`;

  const nav: NavItem[] = [
    { label: 'Calendar', href: base, icon: CalendarDays },
    { label: 'Channels', href: `${base}/channels`, icon: Radio },
    { label: 'Media', href: null, icon: ImageIcon, soon: 'Phase 2' },
    { label: 'Members', href: `${base}/settings/members`, icon: Users },
    { label: 'Settings', href: null, icon: Settings, soon: 'Soon' },
  ];

  const sidebar = (
    <nav aria-label="Workspace" className="flex h-full flex-col gap-4 p-3">
      <div className="flex h-8 items-center justify-between px-1">
        <Logo />
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
      <ul className="flex flex-col gap-0.5">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = item.href !== null && pathname === item.href;
          const content = (
            <>
              <Icon className="size-4" aria-hidden="true" />
              <span className="flex-1">{item.label}</span>
              {item.soon && <Badge>{item.soon}</Badge>}
            </>
          );
          const classes = cn(
            'flex h-8 items-center gap-2 rounded-sm px-2 text-base',
            active
              ? 'bg-sprout-100 font-medium text-sprout-600'
              : 'text-text hover:bg-surface-hover',
            item.href === null && 'cursor-default text-muted hover:bg-transparent',
          );
          return (
            <li key={item.label}>
              {item.href ? (
                <Link
                  href={item.href as '/'}
                  className={classes}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setMobileOpen(false)}
                >
                  {content}
                </Link>
              ) : (
                <span className={classes} aria-disabled="true">
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface md:block">
        {sidebar}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface">
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-border px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-4" aria-hidden="true" />
          </Button>
          <span className="truncate font-medium">{workspace.name}</span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
