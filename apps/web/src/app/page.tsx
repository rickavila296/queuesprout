import Link from 'next/link';
import { buttonVariants, Logo } from '@queuesprout/ui';
import { ThemeToggle } from '@/components/theme-toggle';

const CHANNELS = [
  'Bluesky',
  'Mastodon',
  'Discord',
  'Telegram',
  'Slack',
  'LinkedIn',
  'Pinterest',
  'YouTube',
  'Facebook',
  'Instagram',
  'Threads',
  'TikTok',
];

export default function LandingPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-6">
      <header className="flex h-14 items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/sign-in" className={buttonVariants({ variant: 'secondary' })}>
            Sign in
          </Link>
        </div>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-6 py-16">
        <h1 className="max-w-2xl font-display text-2xl font-semibold">
          Write once. Schedule everywhere. Watch your audience sprout.
        </h1>
        <p className="max-w-xl text-md text-muted">
          QueueSprout is an open-source scheduler for {CHANNELS.length} social channels, with an API
          and webhooks for n8n, Make and AI agents. Self-host it with four containers.
        </p>
        <div className="flex gap-2">
          <Link href="/sign-in" className={buttonVariants({ size: 'lg' })}>
            Get started
          </Link>
          <a
            href="https://github.com/rickavila296/queuesprout"
            className={buttonVariants({ variant: 'secondary', size: 'lg' })}
          >
            GitHub
          </a>
        </div>
        <ul className="flex flex-wrap gap-2 pt-4" aria-label="Supported channels">
          {CHANNELS.map((c) => (
            <li key={c} className="rounded-sm border border-border px-2 py-0.5 text-sm text-muted">
              {c}
            </li>
          ))}
        </ul>
      </main>
      <footer className="flex h-14 items-center gap-4 text-sm text-muted">
        <span>AGPL-3.0</span>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/data-deletion">Data deletion</Link>
      </footer>
    </div>
  );
}
