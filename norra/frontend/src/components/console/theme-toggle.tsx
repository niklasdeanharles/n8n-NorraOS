'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

type Mode = 'light' | 'dark' | 'system';

const MODES: Array<{ value: Mode; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Hell', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dunkel', Icon: Moon },
];

function apply(mode: Mode): void {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/**
 * Hell, System, Dunkel.
 *
 * Die Wahl liegt in `localStorage` und damit nur im Browser dieses Nutzers --
 * eine reine Darstellungsvorliebe gehoert nicht in die Datenbank. Jeder
 * Zugriff ist abgesichert: im privaten Fenster und bei blockierten Site-Daten
 * wirft der Zugriff, und ein geworfener Fehler beim Lesen einer Vorliebe darf
 * die Oberflaeche nicht mitnehmen.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<Mode>('system');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem('norra-theme');
    } catch {
      stored = null;
    }
    if (stored === 'light' || stored === 'dark' || stored === 'system') setMode(stored);
  }, []);

  function choose(next: Mode): void {
    setMode(next);
    apply(next);
    try {
      window.localStorage.setItem('norra-theme', next);
    } catch {
      /* Ohne Speicher gilt die Wahl fuer diese Sitzung -- besser als gar keine. */
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Farbschema"
      className={cn('inline-flex items-center gap-0.5 rounded-full border border-border-hair bg-surface p-0.5', className)}
    >
      {MODES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          title={label}
          onClick={() => choose(value)}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-full p-0 transition-colors duration-200 ease-norra',
            mode === value ? 'bg-brand-subtle text-brand' : 'bg-transparent text-faint hover:text-muted',
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Setzt die Klasse, bevor der erste Pixel gemalt wird.
 *
 * Ohne diesen Schritt blitzt bei dunkler Vorliebe eine Sekunde lang die helle
 * Oberflaeche auf: React laeuft erst nach dem ersten Bild.
 */
export function ThemeScript() {
  const script = `try{var m=localStorage.getItem('norra-theme')||'system';var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
