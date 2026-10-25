import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

const badgeVariants = cva('inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-surface-hover text-muted',
      success: 'bg-sprout-100 text-sprout-600',
      danger: 'border border-danger text-danger',
      // --warning and --info fail AA as text, so they tint the border and the text stays default.
      warning: 'border border-warning text-text',
      info: 'border border-info text-text',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
