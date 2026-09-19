import { cn } from '@/lib/cn';

/**
 * Eine Reihe, kein Diagramm.
 *
 * Bewusst ohne Achsen, Gitter und Legende: die Zahl daneben ist die Aussage,
 * die Linie nur ihre Richtung. Eine einzelne Reihe braucht keine Legende --
 * die Ueberschrift der Karte benennt sie.
 *
 * Der Wertebereich wird auf die eigenen Extremwerte gespannt, nicht auf Null.
 * Fuer einen Verlauf ist das richtig; wer daraus Groessen vergleichen will,
 * braucht ein echtes Diagramm mit Achse.
 */
export function Sparkline({
  values,
  className,
  label,
}: {
  values: readonly number[];
  className?: string;
  /** Was die Linie zeigt -- fuer Screenreader, denen die Form nichts sagt. */
  label: string;
}) {
  if (values.length < 2) return null;

  const width = 120;
  const height = 32;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  // `at(-1)` ist hier nie undefined -- die Laenge ist oben geprueft -- aber der
  // Compiler weiss das nicht, und ein `!` waere genau die Zusicherung, die
  // irgendwann nicht mehr stimmt.
  const last = points.at(-1) ?? points[0];
  if (!last) return null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('h-8 w-[120px] overflow-visible text-brand', className)}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {/* Ring in Flaechenfarbe, damit der Punkt auch auf der Linie abgesetzt bleibt. */}
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--surface)" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="currentColor" />
    </svg>
  );
}
