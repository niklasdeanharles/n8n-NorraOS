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

type ToolDefinition = {
  readonly slug: string;
  readonly hint: string;
  readonly endpoint: string | null;
  readonly channel: ToolChannel;
};

export const TOOL_CATALOGUE = [
  {
    slug: 'lookup_record',
    hint: 'Datensatz im System des Kunden nachschlagen, read-only',
    endpoint: 'Read-only-Endpunkt, den das Tool mit ?query=… aufruft',
    channel: 'both',
  },
  {
    slug: 'escalate_to_human',
    hint: 'Ticket anlegen und an einen Menschen übergeben',
    endpoint: null,
    channel: 'both',
  },
  {
    slug: 'request_action',
    hint: 'Folgenreiche Aktion zur Freigabe einreichen — führt nichts aus',
    endpoint: null,
    channel: 'both',
  },
  {
    slug: 'identify_caller',
    hint: 'Anrufer an seiner Nummer erkennen: Name, frühere Anliegen, Notizen',
    endpoint: null,
    channel: 'voice',
  },
  {
    slug: 'send_sms',
    hint: 'Dem Anrufer eine SMS schicken — für Links, Nummern und Adressen, die man sich nicht merken kann',
    endpoint: null,
    channel: 'voice',
  },
  {
    slug: 'schedule_callback',
    hint: 'Rückruf notieren, statt den Anrufer warten zu lassen',
    endpoint: null,
    channel: 'voice',
  },
  {
    slug: 'transfer_to_department',
    hint: 'An eine Fachabteilung durchstellen — die Nummer kommt aus den Einstellungen, nie vom Agenten',
    endpoint: null,
    channel: 'voice',
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
