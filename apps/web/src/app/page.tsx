import { CircleCheck, CircleDashed, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { PostStatus } from '@queuesprout/shared';
import { buttonVariants, cn, Logo } from '@queuesprout/ui';
import { PostStatusIcon, statusLabel } from '@/components/post-status';
import { ThemeToggle } from '@/components/theme-toggle';

const REPO = 'https://github.com/rickavila296/queuesprout';

/** An example running order. Every client and post here is made up, and the page says so. */
const RUNDOWN: {
  time: string;
  client: string;
  post: string;
  channel: string;
  status: PostStatus;
  note?: string;
}[] = [
  {
    time: '09:00',
    client: 'Bakery (sample)',
    post: 'Autumn menu carousel',
    channel: 'Bluesky',
    status: 'published',
  },
  {
    time: '10:30',
    client: 'Bike shop (sample)',
    post: 'Workshop open day',
    channel: 'Mastodon',
    status: 'failed',
    note: 'Link preview rejected. Retry is ready.',
  },
  {
    time: '14:00',
    client: 'Bakery (sample)',
    post: 'Weekend opening hours',
    channel: 'Telegram',
    status: 'scheduled',
  },
  {
    time: '16:15',
    client: 'Studio (sample)',
    post: 'New team member',
    channel: 'Slack',
    status: 'scheduled',
  },
  {
    time: 'Unset',
    client: 'Bike shop (sample)',
    post: 'Spring service offer',
    channel: 'Discord',
    status: 'draft',
  },
];

type Stage = 'live' | 'planned';

const STAGE: Record<Stage, { label: string; icon: LucideIcon; tone: string }> = {
  live: { label: 'Live', icon: CircleCheck, tone: 'text-success' },
  planned: { label: 'Planned', icon: CircleDashed, tone: 'text-muted' },
};

/** The client-delivery loop, with the honest state of each step today. */
const LOOP: { step: string; what: string; stage: Stage }[] = [
  {
    step: 'Keep each client apart',
    what: 'One space per client with its own channels, media and team. No client can see another.',
    stage: 'live',
  },
  {
    step: 'Write and check',
    what: 'One post, per-channel text, and a check against each platform’s rules before it can be scheduled.',
    stage: 'live',
  },
  {
    step: 'Schedule and publish',
    what: 'A week, month and list calendar. Each channel shows its own status, and a failed post says why and retries without posting twice.',
    stage: 'live',
  },
  {
    step: 'Get client approval',
    what: 'Send a draft for approval and keep a record of who decided, and when.',
    stage: 'planned',
  },
  {
    step: 'Track the month',
    what: 'Set each client’s monthly plan and count what actually published. Scheduled or failed posts never count as delivered.',
    stage: 'planned',
  },
  {
    step: 'Report to the client',
    what: 'A read-only monthly report with planned against delivered work and only the metrics a platform really provides.',
    stage: 'planned',
  },
];

const CHANNELS: { group: string; names: string[] }[] = [
  { group: 'Publishing now', names: ['Bluesky', 'Mastodon', 'Discord', 'Telegram', 'Slack'] },
  {
    group: 'Waiting on platform review',
    names: ['LinkedIn', 'Pinterest', 'Facebook Pages', 'Instagram', 'Threads'],
  },
  { group: 'Coming with video', names: ['YouTube', 'TikTok'] },
];

function StageTag({ stage }: { stage: Stage }) {
  const s = STAGE[stage];
  const Icon = s.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted">
      <Icon className={cn('size-3.5 shrink-0', s.tone)} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="bg-shell text-shell-text">
        <header className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="QueueSprout home">
            <Logo onShell />
          </Link>
          <nav aria-label="Site" className="flex items-center gap-1">
            <a
              href="#how"
              className="hidden rounded-sm px-2 py-1.5 hover:text-shell-strong sm:block"
            >
              How it works
            </a>
            <a
              href="#channels"
              className="hidden rounded-sm px-2 py-1.5 hover:text-shell-strong sm:block"
            >
              Channels
            </a>
            <ThemeToggle className="text-shell-strong hover:bg-shell-hover" />
            <Link
              href="/sign-in"
              className={cn(
                buttonVariants({ variant: 'ghost' }),
                'border border-shell-border text-shell-strong hover:bg-shell-hover',
              )}
            >
              Sign in
            </Link>
          </nav>
        </header>

        <section className="mx-auto max-w-5xl px-4 pt-12 pb-28 sm:px-6 sm:pt-20 sm:pb-36">
          <h1 className="max-w-3xl font-display text-3xl font-semibold text-shell-strong sm:text-4xl">
            From client request to measurable content delivery.
          </h1>
          <p className="mt-5 max-w-xl text-md">
            QueueSprout is for social media managers who publish for several clients. Keep each
            client’s channels, posts and publishing status in one place, and spend less time
            checking what went out.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <Link href="/sign-in" className={buttonVariants({ variant: 'accent', size: 'lg' })}>
              Get started
            </Link>
            <a
              href={REPO}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'border border-shell-border text-shell-strong hover:bg-shell-hover',
              )}
            >
              Read the code
            </a>
          </div>
        </section>
      </div>

      <main className="flex-1">
        <figure className="mx-auto -mt-20 max-w-5xl px-4 sm:-mt-24 sm:px-6">
          <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
            <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
              <p className="font-display text-lg font-semibold">Today, across every client</p>
              <p className="text-sm text-muted">Example</p>
            </div>
            <ol aria-label="Example running order">
              {RUNDOWN.map((r, i) => (
                <li
                  key={r.post}
                  className={cn(
                    'grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-0.5 border-border px-4 py-3 sm:grid-cols-[3.5rem_10rem_1fr_9rem] sm:items-baseline',
                    i > 0 && 'border-t',
                  )}
                >
                  <span className={cn('text-sm text-muted', r.status !== 'draft' && 'font-mono')}>
                    {r.time}
                  </span>
                  <span className="font-medium">{r.client}</span>
                  <span className="col-start-2 min-w-0 sm:col-start-auto">
                    {r.post} <span className="text-sm text-muted">· {r.channel}</span>
                    {r.note && <span className="block text-sm text-attention-text">{r.note}</span>}
                  </span>
                  <span className="col-start-2 inline-flex items-center gap-1.5 text-sm text-muted sm:col-start-auto">
                    <PostStatusIcon status={r.status} />
                    {statusLabel(r.status)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <figcaption className="mt-3 text-sm text-muted">
            An example. The clients and posts are made up; the statuses are the ones QueueSprout
            shows.
          </figcaption>
        </figure>

        <section id="how" className="mx-auto max-w-5xl scroll-mt-6 px-4 pt-20 sm:px-6">
          <h2 className="max-w-2xl font-display text-2xl font-semibold">
            Built toward one promise: show every client what their retainer delivered this month.
          </h2>
          <p className="mt-3 max-w-xl text-muted">
            Each step below says plainly whether it works today. Nothing is listed as live until it
            is.
          </p>
          <ol className="mt-8 border-t border-border">
            {LOOP.map((l) => (
              <li
                key={l.step}
                className="grid gap-1 border-b border-border py-4 sm:grid-cols-[14rem_1fr_6rem] sm:gap-6"
              >
                <h3 className="font-semibold">{l.step}</h3>
                <p className="max-w-prose text-muted">{l.what}</p>
                <div className="sm:text-right">
                  <StageTag stage={l.stage} />
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="channels" className="mx-auto max-w-5xl scroll-mt-6 px-4 pt-20 sm:px-6">
          <h2 className="font-display text-2xl font-semibold">Channels</h2>
          <p className="mt-3 max-w-xl text-muted">
            Twelve channels are in scope. Each one is added only after it works end to end.
          </p>
          <dl className="mt-8 grid gap-6 sm:grid-cols-3">
            {CHANNELS.map((c) => (
              <div key={c.group} className="border-t border-border pt-3">
                <dt className="font-semibold">{c.group}</dt>
                <dd className="mt-2 text-muted">{c.names.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mx-auto max-w-5xl px-4 pt-20 pb-24 sm:px-6">
          <h2 className="font-display text-2xl font-semibold">
            Open source, and built to be checked
          </h2>
          <ul className="mt-6 grid max-w-3xl gap-3 text-muted">
            <li>
              <span className="font-semibold text-text">Sandbox mode</span> runs posts through the
              whole pipeline for demos and testing, and never publishes for real.
            </li>
            <li>
              <span className="font-semibold text-text">Your clients stay apart.</span> Every query
              is checked against the client it belongs to, in the app and again in the database.
            </li>
            <li>
              <span className="font-semibold text-text">AGPL-3.0.</span> Read the code, or host it
              yourself.
            </li>
          </ul>
          <div className="mt-8 flex flex-wrap gap-2">
            <Link href="/sign-in" className={buttonVariants({ size: 'lg' })}>
              Get started
            </Link>
            <a href={REPO} className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
              GitHub
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-5 text-sm text-muted sm:px-6">
          <span>AGPL-3.0</span>
          <Link href="/privacy" className="py-1 hover:text-text">
            Privacy
          </Link>
          <Link href="/terms" className="py-1 hover:text-text">
            Terms
          </Link>
          <Link href="/data-deletion" className="py-1 hover:text-text">
            Data deletion
          </Link>
        </div>
      </footer>
    </div>
  );
}
