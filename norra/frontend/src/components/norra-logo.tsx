import { cn } from '@/lib/cn';

/**
 * Die Marke.
 *
 * Drei Boegen, die von einem Punkt ausgehen, nach aussen leiser werdend. Kein
 * Buchstabe, kein Tier, keine Jahreszahl -- rein geometrisch, damit es in zehn
 * Jahren noch stimmt. Gelesen werden kann es als Nordlicht ueber dem Horizont
 * und als Stimme, die sich ausbreitet; beides passt, und genau deshalb steht
 * dort keine Erklaerung.
 *
 * Die Abstufung liegt in der Deckkraft, nicht in drei Farben: so bleibt die
 * Marke einfarbig und funktioniert geaetzt, gestickt und einfarbig gedruckt.
 */
export function NorraMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('h-6 w-6 text-brand', className)}
    >
      <g stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
        <path d="M1.5 23.2a14.5 14.5 0 0 1 29 0" opacity={0.3} />
        <path d="M6.5 23.2a9.5 9.5 0 0 1 19 0" opacity={0.6} />
        <path d="M11.5 23.2a4.5 4.5 0 0 1 9 0" />
      </g>
      <circle cx={16} cy={23.2} r={1.9} fill="currentColor" />
    </svg>
  );
}

/** Marke auf eigener Flaeche -- fuer App-Icon, Favicon und Login. */
export function NorraIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-md bg-brand text-brand-fg',
        className,
      )}
    >
      <NorraMark className="h-6 w-6 text-current" />
    </span>
  );
}

/** Marke plus Wortmarke. Das Logo selbst bleibt das Symbol; der Name ist Satz. */
export function NorraLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <NorraMark className="h-7 w-7" />
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-text">Norra</span>
    </span>
  );
}
