import type { BusinessHours } from '@/types/database';

/**
 * Business hours, evaluated in the number's own timezone.
 *
 * No date library: `Intl.DateTimeFormat` already knows every timezone and every
 * DST rule, and it ships with the runtime.
 */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAYS)[number];

export const WEEK: readonly DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Montag',
  tue: 'Dienstag',
  wed: 'Mittwoch',
  thu: 'Donnerstag',
  fri: 'Freitag',
  sat: 'Samstag',
  sun: 'Sonntag',
};

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Narrows the jsonb column to the shape the rest of the code relies on. */
export function parseBusinessHours(value: unknown): BusinessHours {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: BusinessHours = {};
  for (const day of WEEK) {
    const ranges = (value as Record<string, unknown>)[day];
    if (!Array.isArray(ranges)) continue;
    const clean: Array<[string, string]> = [];
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2) continue;
      const [from, to] = range;
      if (typeof from !== 'string' || typeof to !== 'string') continue;
      if (!TIME.test(from) || !TIME.test(to) || from >= to) continue;
      clean.push([from, to]);
    }
    if (clean.length > 0) result[day] = clean;
  }
  return result;
}

/** Local weekday and HH:MM in the given timezone. */
export function localNow(timezone: string, at: Date = new Date()): { day: DayKey; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday').toLowerCase().slice(0, 3);
  const day = (DAYS.find((d) => d === weekday) ?? 'mon') as DayKey;
  // Intl renders midnight as "24" in some locales' 24-hour output.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { day, time: `${hour}:${get('minute')}` };
}

/**
 * Whether the line is open right now.
 *
 * An empty configuration means always open: a customer who has not filled in
 * hours wants their number answered, not silently closed.
 */
export function isOpen(hours: BusinessHours, timezone: string, at: Date = new Date()): boolean {
  const configured = WEEK.some((day) => (hours[day]?.length ?? 0) > 0);
  if (!configured) return true;

  const { day, time } = localNow(timezone, at);
  const ranges = hours[day] ?? [];
  return ranges.some(([from, to]) => time >= from && time < to);
}

/** "Mo–Fr 08:00–17:00" style summary for the console. */
export function describeHours(hours: BusinessHours): string {
  const days = WEEK.filter((day) => (hours[day]?.length ?? 0) > 0);
  if (days.length === 0) return 'Rund um die Uhr';
  return days
    .map((day) => `${DAY_LABELS[day].slice(0, 2)} ${(hours[day] ?? []).map(([f, t]) => `${f}–${t}`).join(', ')}`)
    .join(' · ');
}

/**
 * Das Datum in der Zeitzone der Nummer, als `YYYY-MM-DD`.
 *
 * Nicht `toISOString().slice(0, 10)`: das rechnet in UTC. Ein Anruf um 00:30
 * Berliner Zeit am 25. Dezember fiele dort auf den 24. — und ein Schließtag,
 * der auf den 25. eingetragen ist, griffe nicht. `en-CA` liefert genau dieses
 * Format ohne eigenes Zusammenstückeln.
 */
export function localDate(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Nur die Felder, die die Auswertung braucht — nicht die ganze Zeile. */
export type Closure = {
  starts_on: string;
  ends_on: string;
  label: string;
  message: string | null;
  phone_number_id: string | null;
};

/**
 * Der Schließtag, der heute für diese Leitung gilt, oder null.
 *
 * Zeichenketten-Vergleich statt `Date`: `YYYY-MM-DD` sortiert lexikografisch
 * wie chronologisch, und ein `new Date('2026-12-24')` wäre wieder UTC-Mitternacht
 * mit demselben Fehler wie oben.
 *
 * Bei mehreren zutreffenden gewinnt der mit einer Ansage — „wir haben
 * Betriebsferien bis zum sechsten Januar" ist eine bessere Auskunft als der
 * stumme Feiertag, der zufällig hineinfällt.
 */
export function closureFor(
  closures: readonly Closure[],
  numberId: string,
  timezone: string,
  at: Date = new Date(),
): Closure | null {
  const today = localDate(timezone, at);
  const matching = closures.filter(
    (closure) =>
      (closure.phone_number_id === null || closure.phone_number_id === numberId) &&
      closure.starts_on <= today &&
      today <= closure.ends_on,
  );
  if (matching.length === 0) return null;
  return matching.find((closure) => closure.message?.trim()) ?? matching[0] ?? null;
}
