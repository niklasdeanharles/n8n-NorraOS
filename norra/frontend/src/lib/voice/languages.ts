/**
 * Welche Sprachen eine Leitung sprechen kann — und mit welcher Stimme.
 *
 * Eine Auswahlliste und kein Freitextfeld, aus zwei Gründen. Der Sprachcode
 * geht direkt in ein TwiML-Attribut: was dort nicht die Form `de-DE` hat, ist
 * beim Anbieter ein Fehler. Und ein Tippfehler im Stimmnamen fällt nicht auf,
 * er klingt nur — als Roboter, der Deutsch mit englischem Akzent liest.
 *
 * `alice` steht bei jeder Sprache, weil es die einzige Stimme ist, die alle
 * beherrscht. Sie klingt schlechter als eine neurale, aber sie klingt in jeder
 * Sprache gleich schlecht und nie falsch.
 */

export type LanguageOption = {
  readonly code: string;
  readonly label: string;
  /** Erste Stimme ist die Vorgabe. */
  readonly voices: readonly { readonly value: string; readonly label: string }[];
};

export const LANGUAGES: readonly LanguageOption[] = [
  {
    code: 'de-DE',
    label: 'Deutsch',
    voices: [
      { value: 'Polly.Vicki-Neural', label: 'Vicki — weiblich (neural)' },
      { value: 'Polly.Daniel-Neural', label: 'Daniel — männlich (neural)' },
      { value: 'Polly.Hannah-Neural', label: 'Hannah — weiblich (neural)' },
      { value: 'alice', label: 'Alice — Standard' },
    ],
  },
  {
    code: 'en-US',
    label: 'Englisch (US)',
    voices: [
      { value: 'Polly.Joanna-Neural', label: 'Joanna — weiblich (neural)' },
      { value: 'alice', label: 'Alice — Standard' },
    ],
  },
  // Für diese Sprachen ist hier bewusst nur `alice` hinterlegt. Twilios Liste
  // neuraler Polly-Stimmen ändert sich, und ein Name, den ich nicht geprüft
  // habe, wäre genau der Tippfehler, den dieses Modul verhindern soll. Wer eine
  // neurale Stimme will, trägt sie hier ein, nachdem er sie beim Anbieter
  // nachgeschlagen hat — eine Zeile, ein Deploy, kein Ticket.
  { code: 'en-GB', label: 'Englisch (UK)', voices: [{ value: 'alice', label: 'Alice — Standard' }] },
  { code: 'fr-FR', label: 'Französisch', voices: [{ value: 'alice', label: 'Alice — Standard' }] },
  { code: 'es-ES', label: 'Spanisch', voices: [{ value: 'alice', label: 'Alice — Standard' }] },
  { code: 'it-IT', label: 'Italienisch', voices: [{ value: 'alice', label: 'Alice — Standard' }] },
  { code: 'nl-NL', label: 'Niederländisch', voices: [{ value: 'alice', label: 'Alice — Standard' }] },
  { code: 'pl-PL', label: 'Polnisch', voices: [{ value: 'alice', label: 'Alice — Standard' }] },
  { code: 'tr-TR', label: 'Türkisch', voices: [{ value: 'alice', label: 'Alice — Standard' }] },
  { code: 'ru-RU', label: 'Russisch', voices: [{ value: 'alice', label: 'Alice — Standard' }] },
];

/** Alle Stimmen, die irgendeine Sprache anbietet — für das Nummern-Formular. */
export const ALL_VOICES: readonly { value: string; label: string }[] = [
  ...new Map(
    LANGUAGES.flatMap((language) =>
      language.voices.map((voice) => [
        voice.value,
        { value: voice.value, label: `${voice.label.split(' — ')[0]} — ${language.label}` },
      ] as const),
    ),
  ).values(),
];

export function languageLabel(code: string): string {
  return LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

export function isKnownLanguage(code: string): boolean {
  return LANGUAGES.some((language) => language.code === code);
}

/** Ob diese Stimme zu dieser Sprache gehört. */
export function voiceFits(code: string, voice: string): boolean {
  return LANGUAGES.find((language) => language.code === code)?.voices.some((v) => v.value === voice) ?? false;
}

/**
 * Welche Stimme dieser Anruf gerade benutzt.
 *
 * Die Sprache am Anruf gewinnt über die an der Leitung: sie gilt für dieses
 * Gespräch, nicht für das nächste. Drei Routen brauchen dieselbe Antwort —
 * `turn`, `briefing` und `after-transfer` —, und drei Kopien derselben drei
 * Zeilen wären drei Stellen, an denen jemand eine vergisst. Dann spräche die
 * Nachfrage nach dem Durchstellen plötzlich wieder Deutsch.
 */
export function voiceFor(
  call: { language: string | null; voice: string | null } | null,
  number: { language?: string | null; voice?: string | null } | null,
): { voice: string; language: string } {
  if (call?.language && call.voice) return { voice: call.voice, language: call.language };
  return { voice: number?.voice ?? 'alice', language: number?.language ?? 'de-DE' };
}
