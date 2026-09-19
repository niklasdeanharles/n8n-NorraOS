import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Sparkline } from './sparkline';

export type Trend = 'up' | 'down' | 'flat';

/** Ob eine Steigerung gut ist, weiss nur der Messwert: mehr Anrufe ist gut, mehr verpasste nicht. */
export type TrendMeaning = 'more-is-better' | 'less-is-better' | 'neutral';

function toneFor(trend: Trend, meaning: TrendMeaning): 'success' | 'error' | 'muted' {
  if (trend === 'flat' || meaning === 'neutral') return 'muted';
  const good = meaning === 'more-is-better' ? trend === 'up' : trend === 'down';
  return good ? 'success' : 'error';
}

/**
 * Die grosse Kennzahl.
 *
 * Die Richtung steht nie nur in der Farbe: Pfeil und Prozentzahl sagen
 * dasselbe noch einmal, damit die Karte auch ohne Farbwahrnehmung und im
 * Schwarzweissdruck lesbar bleibt.
 */
export function Stat({
  label,
  value,
  unit,
  delta,
  trend = 'flat',
  meaning = 'neutral',
  series,
  hint,
  icon,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  trend?: Trend;
  meaning?: TrendMeaning;
  series?: readonly number[];
  hint?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const tone = toneFor(trend, meaning);
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;

  return (
    <div
      className={cn(
        'group rounded-xl border border-border-hair bg-surface p-5 shadow-card',
        'transition-[box-shadow,transform] duration-300 ease-norra hover:-translate-y-0.5 hover:shadow-lift',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        {icon ? <span className="text-faint [&_svg]:size-4">{icon}</span> : null}
      </div>

      <div className="mt-3 flex items-end gap-1.5">
        <span className="tabular text-[30px] font-semibold leading-none tracking-[-0.03em] text-text">{value}</span>
        {unit ? <span className="pb-0.5 text-[13px] font-medium text-muted">{unit}</span> : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        {delta ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[12px] font-medium',
              tone === 'success' && 'text-success',
              tone === 'error' && 'text-error',
              tone === 'muted' && 'text-faint',
            )}
          >
            <TrendIcon className="size-3.5" aria-hidden="true" />
            {delta}
          </span>
        ) : (
          <span className="text-[12px] text-faint">{hint ?? ''}</span>
        )}
        {series ? <Sparkline values={series} label={`${label}: Verlauf der letzten ${series.length} Tage`} /> : null}
      </div>
    </div>
  );
}
