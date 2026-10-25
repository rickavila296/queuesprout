'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { Button } from '@queuesprout/ui';
import { THEME_STORAGE_KEY } from './theme-script';

type ThemeChoice = 'light' | 'dark' | 'system';
const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];
const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;
const CHANGE_EVENT = 'qs-theme-change';

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice) {
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

/** The saved choice is external state: localStorage, other tabs, and the OS setting. */
function subscribe(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onMedia = () => {
    if (read() === 'system') apply('system');
  };
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  media.addEventListener('change', onMedia);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    media.removeEventListener('change', onMedia);
  };
}

export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, read, () => 'system' as const);

  // Re-apply after React's dev remount clears the attribute the head script set.
  useLayoutEffect(() => {
    apply(read());
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? 'system';
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    apply(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  const Icon = ICONS[choice];
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`Theme: ${choice}. Change theme`}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  );
}
