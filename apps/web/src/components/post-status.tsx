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

export const statusLabel = (s: PostStatus) => STATUS[s].label;
export const statusDotClass = (s: PostStatus) => STATUS[s].dot;

/** A status dot with its label; the label is the accessible part, color only repeats it. */
export function PostStatusDot({ status, className }: { status: PostStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted', className)}>
      <span className={cn('size-2 rounded-full', STATUS[status].dot)} aria-hidden="true" />
      {STATUS[status].label}
    </span>
  );
}
