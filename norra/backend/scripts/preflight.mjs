#!/usr/bin/env node
/**
 * Sagt, was zwischen dem Repository und dem ersten echten Anruf noch steht.
 *
 *   node scripts/preflight.mjs
 *
 * Drei Dinge an Norra entstehen nicht durch Code, sondern durch Klicks in n8n:
 * eine Credential wird angelegt, an einen Node gehaengt, ein Workflow wird
 * aktiviert. Genau die kann dieses Repository nicht garantieren -- und genau
 * die fallen erst auf, wenn ein Kunde in der Leitung ist und der Agent
 * schweigt. Dieses Skript liest den Zustand der Instanz und nennt jeden
 * fehlenden Handgriff beim Namen, statt ihn in einer README zu beschreiben.
 *
 * Nur lesend. Es aendert nichts, weder an der Instanz noch am Repository.
 *
 * Braucht N8N_BASE_URL und N8N_API_KEY.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const WORKFLOW_DIR = path.resolve(import.meta.dirname, '../n8n-workflows');

/**
 * Welcher Node welche Credential braucht.
 *
 * Jeder Eintrag ist gegen die Typdefinition des Nodes geprueft, nicht geraten
 * (n8n MCP `get_node_types`): der Anthropic-Chat-Node deklariert `anthropicApi`,
 * der Twilio-Node `twilioApi`, der Webhook-Node `httpHeaderAuth`, die beiden
 * Supabase-Nodes `supabaseApi`, der Embeddings-Node `openAiApi`.
 *
 * `null` heisst: der Node braucht keine. Ein Typ, der in keiner der beiden
 * Listen steht, wird gemeldet -- sonst waere ein neuer Node ohne Credential
 * genau der Fall, den dieses Skript nicht sieht.
 */
const CREDENTIAL_BY_TYPE = {
  '@n8n/n8n-nodes-langchain.lmChatAnthropic': 'anthropicApi',
  '@n8n/n8n-nodes-langchain.embeddingsOpenAi': 'openAiApi',
  '@n8n/n8n-nodes-langchain.vectorStoreSupabase': 'supabaseApi',
  'n8n-nodes-base.supabase': 'supabaseApi',
  'n8n-nodes-base.twilio': 'twilioApi',
  // Der Gmail-Node akzeptiert OAuth2 *oder* einen Service-Account. Welche von
  // beiden, ist eine Betriebsentscheidung; dass ueberhaupt eine haengt, ist die
  // Bedingung. ANY steht fuer genau diesen Fall.
  'n8n-nodes-base.gmail': { any: true, label: 'Gmail (OAuth2 oder Service-Account)' },
};

/** Nodes, die bewusst keine Credential brauchen. */
const NO_CREDENTIAL = new Set([
  '@n8n/n8n-nodes-langchain.agent',
  '@n8n/n8n-nodes-langchain.documentDefaultDataLoader',
  // Holt sein Modell ueber einen ai_languageModel-Sub-Node; der traegt die Credential.
  '@n8n/n8n-nodes-langchain.informationExtractor',
  '@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter',
  '@n8n/n8n-nodes-langchain.toolWorkflow',
  'n8n-nodes-base.aggregate',
  'n8n-nodes-base.executeWorkflow',
  'n8n-nodes-base.executeWorkflowTrigger',
  'n8n-nodes-base.if',
  'n8n-nodes-base.set',
  'n8n-nodes-base.stickyNote',
]);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ist nicht gesetzt. N8N_BASE_URL und N8N_API_KEY werden beide gebraucht.`);
  return value;
}

async function api(pathname) {
  const base = requireEnv('N8N_BASE_URL').replace(/\/+$/, '');
  const response = await fetch(`${base}/api/v1${pathname}`, {
    headers: { 'X-N8N-API-KEY': requireEnv('N8N_API_KEY'), accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`GET ${pathname} fehlgeschlagen: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return await response.json();
}

async function listWorkflows() {
  const collected = [];
  let cursor;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await api(`/workflows?${query}`);
    collected.push(...(page.data ?? []));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return collected;
}

async function readRepoWorkflows() {
  const files = [];
  for (const dir of (await readdir(WORKFLOW_DIR, { withFileTypes: true })).filter((e) => e.isDirectory())) {
    for (const entry of (await readdir(path.join(WORKFLOW_DIR, dir.name))).filter((e) => e.endsWith('.json'))) {
      const name = `${dir.name}/${entry}`;
      files.push({ name, workflow: JSON.parse(await readFile(path.join(WORKFLOW_DIR, dir.name, entry), 'utf8')) });
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Welche Credential dieser Node braucht, oder null.
 *
 * `any` heisst: irgendeine, weil der Node mehrere Typen akzeptiert und die Wahl
 * eine Betriebsentscheidung ist. Die Bedingung bleibt, dass ueberhaupt eine haengt.
 */
function credentialFor(node) {
  if (node.type === 'n8n-nodes-base.webhook') {
    // Ohne Header-Auth steht der Webhook offen im Netz. Das ist die Grenze
    // zwischen Next.js und n8n; sie faellt nicht auf, wenn sie fehlt.
    return node.parameters?.authentication === 'headerAuth' ? { label: 'httpHeaderAuth' } : null;
  }
  if (node.type === 'n8n-nodes-base.httpRequest') {
    const auth = node.parameters?.authentication;
    return !auth || auth === 'none'
      ? null
      : { any: true, label: 'HTTP-Auth, wie im Node gewaehlt' };
  }
  const entry = CREDENTIAL_BY_TYPE[node.type];
  if (!entry) return null;
  return typeof entry === 'string' ? { label: entry } : entry;
}

/** Ob an diesem Node die verlangte (bzw. bei `any` irgendeine) Credential haengt. */
function hasCredential(node, wanted) {
  const attached = Object.entries(node.credentials ?? {}).filter(([, ref]) => ref?.id);
  if (attached.length === 0) return false;
  return wanted.any === true || attached.some(([type]) => type === wanted.label);
}

/**
 * Der Vergleichsstand eines Workflows: alles, was Verhalten bestimmt, ohne das,
 * was zwischen Repo und Instanz legitim auseinandergeht.
 *
 * Credentials leben nur auf der Instanz, `workflowId.value` eines Tool-Nodes
 * wird beim Deploy eingesetzt, und eine verschobene Node-Position ist keine
 * Aenderung am Verhalten. Ohne diese drei Ausnahmen meldete der Drift-Check bei
 * jedem Lauf alles.
 */
function behaviour(workflow) {
  const nodes = (workflow.nodes ?? [])
    .map(({ credentials, position, ...node }) => {
      if (node.type !== '@n8n/n8n-nodes-langchain.toolWorkflow') return node;
      const ref = node.parameters?.workflowId;
      if (!ref || typeof ref !== 'object') return node;
      return { ...node, parameters: { ...node.parameters, workflowId: { ...ref, value: '' } } };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return JSON.stringify({ nodes, connections: workflow.connections ?? {} });
}

const blockers = [];
const notes = [];
const block = (text) => blockers.push(text);
const note = (text) => notes.push(text);

async function run() {
  const repoFiles = await readRepoWorkflows();
  const live = await listWorkflows();
  const liveById = new Map(live.map((w) => [w.id, w]));
  const liveByName = new Map(live.map((w) => [w.name, w]));

  // Fehlende Credentials sammeln sich pro Typ. Einzeln gemeldet ergaeben sie
  // eine Liste, in der dreimal dasselbe fehlende Konto steht.
  const missingCredentials = new Map();
  const unknownTypes = new Set();

  for (const { name, workflow } of repoFiles) {
    const claimed = workflow.norra?.workflowId;
    const target = claimed ? liveById.get(claimed) : liveByName.get(workflow.name);

    if (!target) {
      block(
        claimed
          ? `${name} beansprucht die ID ${claimed}, die es auf der Instanz nicht gibt`
          : `${name} existiert nicht auf der Instanz — anlegen mit: node scripts/n8n-sync.mjs deploy --create-missing`,
      );
    } else if (!claimed) {
      note(`${name} hat noch keine ID im Repo; auf der Instanz liegt sie als ${target.id} — deploy --create-missing traegt sie nach`);
    }

    const isWebhook = (workflow.nodes ?? []).some((n) => n.type === 'n8n-nodes-base.webhook');
    if (target && isWebhook && !target.active) {
      block(`${workflow.name} ist inaktiv — ein inaktiver Webhook antwortet mit 404, der Anruf bricht ab`);
    }

    // Credentials haengen an der Instanz, nicht im Repo. Ist der Workflow noch
    // nicht da, gilt trotzdem, was er brauchen wird: der Bedarf steht in seinen
    // Nodes und ist damit heute schon nennbar.
    for (const node of (target ?? workflow).nodes ?? []) {
      if (!(node.type in CREDENTIAL_BY_TYPE) && !NO_CREDENTIAL.has(node.type) &&
          node.type !== 'n8n-nodes-base.webhook' && node.type !== 'n8n-nodes-base.httpRequest') {
        unknownTypes.add(node.type);
      }
      const wanted = credentialFor(node);
      if (!wanted) continue;
      if (target && hasCredential(node, wanted)) continue;
      if (!missingCredentials.has(wanted.label)) missingCredentials.set(wanted.label, new Map());
      const byWorkflow = missingCredentials.get(wanted.label);
      const where = `${workflow.name}${target ? '' : ' (noch nicht angelegt)'}`;
      if (!byWorkflow.has(where)) byWorkflow.set(where, []);
      byWorkflow.get(where).push(node.name);
    }

    if (target && behaviour(workflow) !== behaviour(target)) {
      note(`${name} weicht von der Instanz ab — node scripts/n8n-sync.mjs deploy schreibt den Repo-Stand`);
    }
  }

  // Nach Workflow gruppiert: eine fehlende Credential haengt an vielen Nodes,
  // und eine Liste aus zweiunddreissig Zeilen begraebt die uebrigen Funde.
  for (const [type, byWorkflow] of [...missingCredentials].sort()) {
    const nodes = [...byWorkflow.values()].reduce((sum, list) => sum + list.length, 0);
    const lines = [...byWorkflow].map(([name, list]) => `      ${name}: ${list.join(', ')}`);
    const subject = nodes === 1 ? 'dem Node, der sie braucht' : `keinem der ${nodes} Nodes, die sie brauchen`;
    block(`Credential "${type}" haengt an ${subject}:\n${lines.join('\n')}`);
  }

  // Ein Tool-Node ohne aufgeloeste Ziel-ID scheitert erst beim Aufruf, also
  // mitten im Gespraech. Auf der Instanz, nicht im Repo, weil der Deploy die
  // ID dort einsetzt.
  for (const workflow of live.filter((w) => w.name?.startsWith('Norra – '))) {
    for (const node of workflow.nodes ?? []) {
      if (node.type !== '@n8n/n8n-nodes-langchain.toolWorkflow') continue;
      const ref = node.parameters?.workflowId;
      const id = typeof ref === 'object' ? ref?.value : ref;
      const wants = typeof ref === 'object' ? ref?.cachedResultName : undefined;
      if (id && liveById.has(id)) continue;

      // Fehlt der Sub-Workflow ohnehin schon, ist der offene Verweis dieselbe
      // Nachricht ein zweites Mal -- der create-Schritt setzt beides gerade.
      if (wants && !liveByName.has(wants)) {
        note(`${workflow.name} › ${node.name} bleibt offen, bis ${wants} auf der Instanz liegt`);
      } else {
        block(`${workflow.name} › ${node.name} zeigt auf ${id || 'nichts'}${wants ? ` (soll: ${wants})` : ''}`);
      }
    }
  }

  if (unknownTypes.size > 0) {
    note(`Node-Typen, die die Credential-Tabelle nicht kennt — Eintrag in CREDENTIAL_BY_TYPE oder NO_CREDENTIAL fehlt: ${[...unknownTypes].join(', ')}`);
  }

  console.log(`Norra — Startbereitschaft\nInstanz: ${process.env.N8N_BASE_URL}\n`);
  console.log(`  ${repoFiles.length} Workflow(s) im Repo, ${live.filter((w) => w.name?.startsWith('Norra – ')).length} auf der Instanz\n`);

  if (blockers.length > 0) {
    console.log('Das steht dem ersten echten Anruf im Weg:\n');
    for (const item of blockers) console.log(`  ✖ ${item}`);
    console.log('');
  }
  if (notes.length > 0) {
    console.log('Hinweise:\n');
    for (const item of notes) console.log(`  · ${item}`);
    console.log('');
  }
  if (blockers.length === 0) {
    console.log('Nichts blockiert. Die Instanz kann einen Anruf annehmen.\n');
  }

  process.exit(blockers.length > 0 ? 1 : 0);
}

try {
  await run();
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(2);
}
