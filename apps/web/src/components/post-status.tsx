import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  ClockAlert,
  Hourglass,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react';
import type { PostStatus } from '@queuesprout/shared';
import { cn } from '@queuesprout/ui';

interface Shown {
  label: string;
  icon: LucideIcon;
  /** Colour of the icon. Words stay in the default or muted text colour. */
  tone: string;
}

/** One status vocabulary for the whole app (DESIGN.md, Status indicators). */
const STATUS: Record<PostStatus, Shown> = {
  draft: { label: 'Draft', icon: CircleDashed, tone: 'text-muted' },
  pending_approval: { label: 'Awaiting approval', icon: Hourglass, tone: 'text-attention-text' },
  scheduled: { label: 'Scheduled', icon: Clock, tone: 'text-info' },
  queued: { label: 'Queued', icon: LoaderCircle, tone: 'text-info' },
  publishing: { label: 'Publishing', icon: LoaderCircle, tone: 'text-info' },
  processing: { label: 'Processing', icon: LoaderCircle, tone: 'text-info' },
  published: { label: 'Published', icon: CircleCheck, tone: 'text-success' },
  failed: { label: 'Failed', icon: CircleAlert, tone: 'text-danger' },
  cancelled: { label: 'Cancelled', icon: CircleSlash, tone: 'text-muted' },
};

const OVERDUE: Shown = { label: 'Waiting to send', icon: ClockAlert, tone: 'text-attention-text' };

const shownFor = (status: PostStatus, overdue: boolean) => (overdue ? OVERDUE : STATUS[status]);

export const statusLabel = (s: PostStatus) => STATUS[s].label;

/** The status icon alone, for tight places such as calendar chips. Its label must be nearby. */
export function PostStatusIcon({
  status,
  overdue = false,
  className,
}: {
  status: PostStatus;
  overdue?: boolean;
  className?: string;
}) {
  const shown = shownFor(status, overdue);
  const Icon = shown.icon;
  return <Icon className={cn('size-3.5 shrink-0', shown.tone, className)} aria-hidden="true" />;
}

/** Icon plus label; the label is the accessible part, colour and shape only repeat it. */
export function PostStatusDot({
  status,
  overdue = false,
  className,
}: {
  status: PostStatus;
  overdue?: boolean;
  className?: string;
}) {
  const shown = shownFor(status, overdue);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs text-muted', className)}
      title={overdue ? 'Its time has passed. Check that the worker is running.' : undefined}
    >
      <PostStatusIcon status={status} overdue={overdue} />
      {shown.label}
    </span>
  );
}
