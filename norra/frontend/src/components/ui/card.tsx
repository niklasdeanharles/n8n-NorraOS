import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Grosse Karte mit feinem Schatten -- der Grundbaustein der Oberflaeche.
 *
 * Rahmen *und* Schatten waeren doppelt gemoppelt; der Rahmen ist hier so
 * zurueckgenommen, dass er nur die Kante definiert, und der Schatten traegt
 * die Tiefe.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border-hair bg-surface shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-start justify-between gap-4 px-6 pt-5 pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-[15px] font-semibold tracking-[-0.01em] text-text', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-[13px] leading-relaxed text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />;
}
