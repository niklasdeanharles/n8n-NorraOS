import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Klassen zusammenfuehren, spaetere Utilities gewinnen.
 *
 * `clsx` allein reicht nicht: `cn('px-4', 'px-6')` ergaebe beide Klassen, und
 * welche gewinnt, entschiede die Reihenfolge im erzeugten Stylesheet -- nicht
 * die im Aufruf. `twMerge` loest den Konflikt nach Utility-Gruppe auf.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
