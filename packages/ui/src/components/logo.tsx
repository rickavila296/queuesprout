import { cn } from '../cn';

/** Sprout (two leaves) rising from the queue line. Reads at 16 px. */
export function SproutMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('size-5', className)} fill="none">
      <path d="M12 20V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 12C12 8 9.5 5.5 5 5.5c0 4 2.5 6.5 7 6.5Z" fill="currentColor" />
      <path d="M12 10.5c0-3.5 2.3-6 6.5-6 0 3.6-2.3 6-6.5 6Z" fill="currentColor" opacity="0.7" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** On the pine shell pass `onShell`: the mark turns lime and the name paper. */
export function Logo({ className, onShell = false }: { className?: string; onShell?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-semibold',
        onShell ? 'text-shell-strong' : 'text-text',
        className,
      )}
    >
      <SproutMark className={onShell ? 'text-accent' : 'text-text'} />
      QueueSprout
    </span>
  );
}
