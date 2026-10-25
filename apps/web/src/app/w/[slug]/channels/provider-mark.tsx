import type { ProviderId } from '@queuesprout/shared';
import { cn } from '@queuesprout/ui';
import { PROVIDER_LABELS } from '@/lib/providers';

/**
 * A neutral letter mark. Platform logos come with their brand rules, so they arrive with
 * each real adapter rather than as a generic set.
 */
export function ProviderMark({
  provider,
  className,
}: {
  provider: ProviderId;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-surface-hover text-xs font-semibold text-muted',
        className,
      )}
    >
      {PROVIDER_LABELS[provider].slice(0, 1)}
    </span>
  );
}
