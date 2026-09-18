/**
 * Stimm-Konfiguration eines Agenten, wie sie in `agents.voice_config` liegt.
 *
 * Die Form ist in der Datenbank per Check-Constraint erzwungen
 * (`private.voice_config_valid`), hier aber trotzdem noch einmal geprüft: was
 * aus der Datenbank kommt, ist für TypeScript `Json` und damit unbekannt, und
 * eine Zeile, die vor dem Constraint geschrieben wurde, gäbe es sonst ohne
 * Vorwarnung als `undefined` weiter in die TwiML.
 */
export type VoiceConfig = {
  keyterms?: string[];
  extract?: Array<{ name: string; prompt: string }>;
  followup?: { target: 'email'; address: string };
};

/** Mehr als das sagt Twilio nichts Gutes mehr: die Liste fährt bei jedem Zug mit. */
const MAX_HINTS = 50;

/**
 * Macht aus den Keyterms eines Agenten das `hints`-Attribut für `<Gather>`.
 *
 * Twilio erwartet eine kommaseparierte Liste. Ein Komma *im* Begriff würde ihn
 * in zwei zerlegen, deshalb fliegen solche Einträge raus statt still zu
 * zerfallen — ein halber Produktname als Hinweis ist schlechter als keiner.
 *
 * Gibt `undefined` zurück, wenn nichts übrig bleibt: `gather()` lässt das
 * Attribut dann ganz weg, statt ein leeres zu schreiben.
 */
export function hintsFrom(config: unknown): string | undefined {
  const terms = readKeyterms(config);
  if (terms.length === 0) return undefined;

  const seen = new Set<string>();
  const kept: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed || trimmed.includes(',')) continue;
    // Groß-/Kleinschreibung unterscheidet keine zwei Hinweise für die
    // Spracherkennung, wohl aber zwei Einträge in einer Liste.
    const key = trimmed.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(trimmed);
    if (kept.length === MAX_HINTS) break;
  }

  return kept.length > 0 ? kept.join(', ') : undefined;
}

/** Liest `voice_config.extract`, oder eine leere Liste, wenn nichts Brauchbares dasteht. */
export function extractFieldsFrom(config: unknown): Array<{ name: string; prompt: string }> {
  if (!isRecord(config) || !Array.isArray(config.extract)) return [];
  return config.extract.filter(
    (field): field is { name: string; prompt: string } =>
      isRecord(field) && typeof field.name === 'string' && typeof field.prompt === 'string',
  );
}

function readKeyterms(config: unknown): string[] {
  if (!isRecord(config) || !Array.isArray(config.keyterms)) return [];
  return config.keyterms.filter((term): term is string => typeof term === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
