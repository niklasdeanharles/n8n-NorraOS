import { EXPECTED_WORKFLOWS, inactiveIsBlocking } from './workflows';

/**
 * Der lesende Blick auf die n8n-Instanz.
 *
 * Drei Dinge an Norra entstehen nicht durch Code, sondern durch Klicks in n8n:
 * eine Credential wird angelegt, an einen Node gehängt, ein Workflow wird
 * aktiviert. Genau die fallen erst auf, wenn ein Kunde in der Leitung ist und
 * der Agent schweigt. `norra-backend/scripts/preflight.mjs` sagt dasselbe auf
 * der Kommandozeile; hier steht es dort, wo auch jemand hinsieht, der kein
 * Terminal offen hat.
 *
 * **Nur lesend.** Kein Aufruf hier verändert die Instanz.
 */

/** Was die n8n-API von einem Workflow zurückgibt — nur die Felder, die hier zählen. */
type LiveWorkflow = {
  id: string;
  name: string;
  active: boolean;
  updatedAt?: string;
  nodes?: Array<{
    name: string;
    type: string;
    parameters?: Record<string, unknown>;
  }>;
};

type LiveExecution = {
  id: string | number;
  workflowId?: string;
  status?: string;
  startedAt?: string;
  stoppedAt?: string;
};

export type OpsFinding = {
  /** `block` steht dem nächsten echten Anruf im Weg, `note` ist ein Hinweis. */
  readonly level: 'block' | 'note';
  readonly text: string;
};

export type OpsWorkflow = {
  readonly name: string;
  readonly file: string | null;
  readonly trigger: 'webhook' | 'schedule' | 'sub' | 'fremd';
  readonly present: boolean;
  readonly active: boolean;
  readonly updatedAt: string | null;
};

export type OpsReport =
  | { readonly kind: 'ready'; readonly workflows: OpsWorkflow[]; readonly findings: OpsFinding[]; readonly failedRuns: LiveExecution[]; readonly baseUrl: string }
  | { readonly kind: 'unconfigured'; readonly missing: string[] }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unreachable'; readonly reason: string };

/** Die beiden Variablen, ohne die es diesen Blick nicht gibt. */
function opsEnv(): { baseUrl: string; apiKey: string; opsOrgId: string } | { missing: string[] } {
  const missing: string[] = [];
  const baseUrl = process.env.N8N_BASE_URL ?? process.env.N8N_WEBHOOK_URL ?? '';
  const apiKey = process.env.N8N_API_KEY ?? '';
  const opsOrgId = process.env.NORRA_OPS_ORG_ID ?? '';
  if (!baseUrl) missing.push('N8N_BASE_URL');
  if (!apiKey) missing.push('N8N_API_KEY');
  if (!opsOrgId) missing.push('NORRA_OPS_ORG_ID');
  return missing.length > 0 ? { missing } : { baseUrl, apiKey, opsOrgId };
}

async function api<T>(baseUrl: string, apiKey: string, pathname: string): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1${pathname}`, {
    headers: { 'X-N8N-API-KEY': apiKey, accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${pathname}: ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Der Zustand der Instanz, gefiltert auf das, was ohne das Backend-Repository
 * beantwortbar ist.
 *
 * Fehlende Credentials stehen bewusst **nicht** darin. Die Frage „welcher Node
 * braucht welchen Typ" hat ihre Antwort in `preflight.mjs`, und eine zweite
 * Kopie davon hier wäre eine, die irgendwann etwas anderes behauptet. Der
 * Screen nennt stattdessen den Befehl.
 */
export async function readInstance(viewerOrgId: string): Promise<OpsReport> {
  const env = opsEnv();
  if ('missing' in env) return { kind: 'unconfigured', missing: env.missing };

  // Fail closed: ohne ausdrücklich benannte Betreiber-Organisation sieht das
  // niemand. Die Instanz ist über alle Mandanten hinweg dieselbe, und wessen
  // Workflows dort liegen, geht einen Kunden nichts an.
  if (env.opsOrgId !== viewerOrgId) return { kind: 'forbidden' };

  let live: LiveWorkflow[];
  let failedRuns: LiveExecution[] = [];
  try {
    const page = await api<{ data?: LiveWorkflow[] }>(env.baseUrl, env.apiKey, '/workflows?limit=200');
    live = page.data ?? [];
    const runs = await api<{ data?: LiveExecution[] }>(env.baseUrl, env.apiKey, '/executions?status=error&limit=8');
    failedRuns = runs.data ?? [];
  } catch (error) {
    // Eine unerreichbare Instanz ist selbst der Befund. Sie als leere Liste zu
    // zeigen hieße: alles fehlt — und das stimmt dann gerade nicht.
    return { kind: 'unreachable', reason: error instanceof Error ? error.message : 'unbekannt' };
  }

  const byName = new Map(live.map((w) => [w.name, w]));
  const byId = new Map(live.map((w) => [w.id, w]));
  const findings: OpsFinding[] = [];
  const workflows: OpsWorkflow[] = [];

  for (const expected of EXPECTED_WORKFLOWS) {
    const found = byName.get(expected.name);
    workflows.push({
      name: expected.name,
      file: expected.file,
      trigger: expected.trigger,
      present: Boolean(found),
      active: found?.active ?? false,
      updatedAt: found?.updatedAt ?? null,
    });
    if (!found) {
      findings.push({ level: 'block', text: `${expected.name} liegt nicht auf der Instanz — anlegen mit: node scripts/n8n-sync.mjs deploy --create-missing` });
      continue;
    }
    if (!found.active && inactiveIsBlocking(expected.trigger)) {
      findings.push({
        level: 'block',
        text: expected.trigger === 'webhook'
          ? `${expected.name} ist inaktiv — ein inaktiver Webhook antwortet mit 404, der Anruf bricht ab`
          : `${expected.name} ist inaktiv — der Zeitplan läuft nicht, es wird niemand angerufen`,
      });
    }
  }

  // Ein Tool-Node ohne aufgelöste Ziel-ID scheitert erst beim Aufruf, also
  // mitten im Gespräch.
  for (const workflow of live.filter((w) => w.name.startsWith('Norra – '))) {
    for (const node of workflow.nodes ?? []) {
      if (node.type !== '@n8n/n8n-nodes-langchain.toolWorkflow') continue;
      const ref = node.parameters?.workflowId;
      const id = typeof ref === 'object' && ref !== null && 'value' in ref ? String((ref as { value: unknown }).value ?? '') : String(ref ?? '');
      if (id && byId.has(id)) continue;
      findings.push({ level: 'block', text: `${workflow.name} › ${node.name} zeigt auf ${id || 'nichts'}` });
    }
  }

  // Fremde Workflows auf derselben Instanz sind kein Fehler — die Instanz
  // gehört nicht Norra allein. Sie werden gezählt, nicht bewertet.
  const foreign = live.filter((w) => !w.name.startsWith('Norra – ')).length;
  if (foreign > 0) findings.push({ level: 'note', text: `${foreign} Workflow(s) auf der Instanz gehören nicht zu Norra und bleiben unangetastet` });

  findings.push({ level: 'note', text: 'Ob an jedem Node eine Credential hängt, prüft `node scripts/preflight.mjs` im Backend-Repo — diese Seite kennt die Zuordnung Node → Credential-Typ bewusst nicht.' });

  return { kind: 'ready', workflows, findings, failedRuns, baseUrl: env.baseUrl };
}
