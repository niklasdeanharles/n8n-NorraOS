/**
 * The tools an agent can be given, one list for the whole app.
 *
 * A slug here is a contract with three parties at once: the agent
 * configuration writes it to `agents.tools`, an n8n sub-workflow writes the
 * same string to `tool_calls_log.tool_name`, and a test case asserts against
 * that column. A second copy of this list is how a test silently starts
 * asserting a tool name nothing ever writes.
 */
export const TOOL_CATALOGUE = [
  {
    slug: 'lookup_record',
    hint: 'Datensatz im System des Kunden nachschlagen, read-only',
    endpoint: 'Read-only-Endpunkt, den das Tool mit ?query=… aufruft',
  },
  {
    slug: 'escalate_to_human',
    hint: 'Ticket anlegen und an einen Menschen übergeben',
    endpoint: null,
  },
  {
    slug: 'request_action',
    hint: 'Folgenreiche Aktion zur Freigabe einreichen — führt nichts aus',
    endpoint: null,
  },
] as const;

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
