/**
 * The tools an agent can be given, one list for the whole app.
 *
 * A slug here is a contract with three parties at once: the agent
 * configuration writes it to `agents.tools`, an n8n sub-workflow writes the
 * same string to `tool_calls_log.tool_name`, and a test case asserts against
 * that column. A second copy of this list is how a test silently starts
 * asserting a tool name nothing ever writes.
 */

/**
 * Where a tool can actually run.
 *
 * Not a preference — a fact about what the tool needs. The four phone tools
 * take a `call_id`, and a chat conversation has none, so offering them on a
 * chat-only agent would offer something that fails at the first turn.
 */
export type ToolChannel = 'both' | 'voice';

/**
 * Ein Wert, den ein Tool pro Organisation braucht, um überhaupt etwas zu tun.
 *
 * Er steht in `agents.tools[].config` und wird im Agenten-Editor gepflegt —
 * nicht im Workflow. Der Grund ist derselbe wie bei der Rufnummer einer
 * Abteilung: was ein Tool *anspricht*, darf nie aus dem Modell kommen. Läge die
 * Kalender-ID im Gesprächskontext, könnte ein präparierter Satz sie ersetzen.
 */
export type ToolConfigField = {
  readonly key: string;
  readonly kind: 'url' | 'text' | 'number';
  readonly label: string;
  readonly placeholder: string;
  /** Ein fehlender Pflichtwert lässt das Tool gar nicht erst speichern. */
  readonly required: boolean;
};

type ToolDefinition = {
  readonly slug: string;
  readonly hint: string;
  readonly config: readonly ToolConfigField[];
  readonly channel: ToolChannel;
};

export const TOOL_CATALOGUE = [
  {
    slug: 'lookup_record',
    hint: 'Datensatz im System des Kunden nachschlagen, read-only',
    config: [{
      key: 'url', kind: 'url', required: true,
      label: 'Read-only-Endpunkt, den das Tool mit ?query=… aufruft',
      placeholder: 'https://api.example.com/records',
    }],
    channel: 'both',
  },
  {
    slug: 'escalate_to_human',
    hint: 'Ticket anlegen und an einen Menschen übergeben',
    config: [],
    channel: 'both',
  },
  {
    slug: 'request_action',
    hint: 'Folgenreiche Aktion zur Freigabe einreichen — führt nichts aus',
    config: [],
    channel: 'both',
  },
  {
    slug: 'identify_caller',
    hint: 'Anrufer an seiner Nummer erkennen: Name, frühere Anliegen, Notizen',
    config: [],
    channel: 'voice',
  },
  {
    slug: 'send_sms',
    hint: 'Dem Anrufer eine SMS schicken — für Links, Nummern und Adressen, die man sich nicht merken kann',
    config: [],
    channel: 'voice',
  },
  {
    slug: 'schedule_callback',
    hint: 'Rückruf notieren, statt den Anrufer warten zu lassen',
    config: [],
    channel: 'voice',
  },
  {
    slug: 'transfer_to_department',
    hint: 'An eine Fachabteilung durchstellen — die Nummer kommt aus den Einstellungen, nie vom Agenten',
    config: [],
    channel: 'voice',
  },
  {
    slug: 'take_message',
    hint: 'Nachricht für eine Person im Haus aufnehmen und ihr zustellen — kein Rückruf, sondern der Inhalt',
    config: [],
    channel: 'voice',
  },
  {
    slug: 'transfer_to_person',
    hint: 'An eine Person aus dem Verzeichnis durchstellen, mit einem Satz Briefing vorab — die Nummer kommt aus dem Verzeichnis, nie vom Agenten',
    config: [],
    channel: 'voice',
  },
  {
    slug: 'lookup_order',
    hint: 'Bestellung oder Auftrag nachschlagen — aus der Quelle, die im Screen Bestellungen hinterlegt ist',
    config: [
      {
        key: 'source_label', kind: 'text', required: false,
        label: 'Welche Quelle, falls mehrere hinterlegt sind. Leer heißt: die einzige aktive.',
        placeholder: 'Bestellungen 2026',
      },
    ],
    // Beide Kanäle: eine Bestellnummer nennt man am Telefon genauso wie im Chat.
    channel: 'both',
  },
  {
    slug: 'book_appointment',
    hint: 'Termin im Kalender eintragen — prüft erst die Verfügbarkeit, sagt nichts zu, was belegt ist',
    config: [
      {
        key: 'calendar_id', kind: 'text', required: true,
        label: 'Kalender, in den eingetragen wird. Die Adresse des Google-Kalenders, nicht sein Anzeigename.',
        placeholder: 'team@kunde.de',
      },
      {
        key: 'duration_minutes', kind: 'number', required: false,
        label: 'Dauer eines Termins in Minuten. Leer heißt 30.',
        placeholder: '30',
      },
    ],
    channel: 'both',
  },
] as const satisfies readonly ToolDefinition[];

export type ToolSlug = (typeof TOOL_CATALOGUE)[number]['slug'];

export const TOOL_SLUGS: readonly string[] = TOOL_CATALOGUE.map((tool) => tool.slug);

export function isToolSlug(value: string): value is ToolSlug {
  return TOOL_SLUGS.includes(value);
}

/**
 * The slugs on an agent, narrowed from the `agents.tools` json column.
 *
 * The column is `jsonb`, so its type says nothing; anything that is not a
 * string in the catalogue is dropped rather than trusted. Unknown entries do
 * exist in practice — a tool removed from the catalogue leaves its slug behind
 * in every agent row that had it.
 */
export function enabledToolSlugs(value: unknown): ToolSlug[] {
  if (!Array.isArray(value)) return [];
  const slugs: ToolSlug[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && isToolSlug(entry) && !slugs.includes(entry)) slugs.push(entry);
  }
  return slugs;
}

/** The tools that only work on a phone line. */
export const VOICE_ONLY_SLUGS: readonly ToolSlug[] = TOOL_CATALOGUE.filter(
  (tool) => tool.channel === 'voice',
).map((tool) => tool.slug);

export function isVoiceOnlyTool(slug: ToolSlug): boolean {
  return VOICE_ONLY_SLUGS.includes(slug);
}
