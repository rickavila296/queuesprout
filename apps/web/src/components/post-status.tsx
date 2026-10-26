import type { PostStatus } from '@queuesprout/shared';
import { cn } from '@queuesprout/ui';

const STATUS: Record<PostStatus, { label: string; dot: string }> = {
  draft: { label: 'Draft', dot: 'border border-muted bg-transparent' },
  pending_approval: { label: 'Awaiting approval', dot: 'bg-warning' },
  scheduled: { label: 'Scheduled', dot: 'bg-info' },
  queued: { label: 'Queued', dot: 'bg-warning' },
  publishing: { label: 'Publishing', dot: 'bg-warning' },
  processing: { label: 'Processing', dot: 'bg-warning' },
  published: { label: 'Published', dot: 'bg-sprout-500' },
  failed: { label: 'Failed', dot: 'bg-danger' },
  cancelled: { label: 'Cancelled', dot: 'bg-surface-hover' },
};

const OVERDUE = { label: 'Waiting to send', dot: 'bg-warning' };

export const statusLabel = (s: PostStatus) => STATUS[s].label;
export const statusDotClass = (s: PostStatus) => STATUS[s].dot;

/** A status dot with its label; the label is the accessible part, color only repeats it. */
export function PostStatusDot({
  status,
  overdue = false,
  className,
}: {
  status: PostStatus;
  overdue?: boolean;
  className?: string;
}) {
  const shown = overdue ? OVERDUE : STATUS[status];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs text-muted', className)}
      title={overdue ? 'Its time has passed. Check that the worker is running.' : undefined}
    >
      <span className={cn('size-2 rounded-full', shown.dot)} aria-hidden="true" />
      {shown.label}
    </span>
  );
}
