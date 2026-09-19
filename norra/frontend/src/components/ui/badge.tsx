import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const badge = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-5',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-muted text-muted border border-border-hair',
        brand: 'bg-brand-subtle text-brand',
        success: 'bg-accent-subtle text-success',
        warning: 'bg-warning/12 text-warning',
        error: 'bg-error/12 text-error',
        info: 'bg-info/12 text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}

/** Ein Punkt in Statusfarbe. Farbe allein traegt nie die Aussage -- daneben steht immer Text. */
export function StatusDot({ tone, className }: { tone: 'success' | 'warning' | 'error' | 'neutral'; className?: string }) {
  const color = {
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
    neutral: 'bg-faint',
  }[tone];
  return <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', color, className)} />;
}
