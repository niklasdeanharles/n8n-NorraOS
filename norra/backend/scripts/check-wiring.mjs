#!/usr/bin/env node
/**
 * Checks that the n8n workflows and the Next.js app still agree.
 *
 *   node scripts/check-wiring.mjs
 *
 * Three things drift silently and each breaks the product without breaking a
 * build: a webhook path renamed on one side, a payload field the workflow stops
 * reading, and a column a workflow writes that the schema no longer has. Every
 * one of those fails at runtime, in production, on a customer's message.
 *
 * The schema is read from the migrations rather than a live database so this
 * runs anywhere, including in a pull request with no Postgres attached.
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKFLOWS = path.join(ROOT, 'n8n-workflows');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

/**
 * The app lives beside this repository rather than inside it, so half of what
 * this script checks is only reachable when that checkout is present. Point
 * NORRA_APP_DIR at it, or use one of the two layouts below and it is found
 * without configuration.
 *
 * Without it the schema-versus-workflow half still runs: that is the half this
 * repository can actually break on its own, and it is the half a deploy job
 * here needs. The app-side half runs in the frontend repository's CI, which is
 * where a route or a payload field changes in the first place.
 */
const APP_CANDIDATES = [
  process.env.NORRA_APP_DIR,
  path.join(ROOT, '../norra-frontend'), // two repositories side by side
  path.join(ROOT, '../frontend'),       // norra/backend and norra/frontend
].filter(Boolean);

const APP = APP_CANDIDATES
  .map((candidate) => path.resolve(candidate))
  .find((candidate) => existsSync(path.join(candidate, 'src/lib/n8n/client.ts')))
  ?? path.resolve(APP_CANDIDATES[0]);

const CLIENT = path.join(APP, 'src/lib/n8n/client.ts');
const APP_PRESENT = existsSync(CLIENT);

const problems = [];
const notes = [];

/** Table -> Set(columns), assembled from CREATE TABLE and ALTER TABLE ADD COLUMN. */
/** `table.column` for every column the database fills without being told. */
const selfFilled = new Set();

async function readSchema() {
  const schema = new Map();
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS, file), 'utf8');

    for (const match of sql.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const [, table, body] = match;
      const columns = schema.get(table) ?? new Set();
      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        // Column definitions start with the name; constraints and checks do not.
        const column = /^(\w+)\s+[a-z]/i.exec(trimmed);
        if (column && !/^(constraint|primary|unique|check|foreign|create)\b/i.test(trimmed)) {
          columns.add(column[1]);
          // Only a *generating* default means the database supplies the real
          // value: now(), a uuid, a sequence, a generated column. A literal
          // default is a placeholder someone is expected to move off, and
          // treating it as filled is how this check first failed to see
          // `agent_test_runs.tools_used` sitting empty on every run.
          // `default now()`, `default (now() + interval '7 days')`, a
          // sequence, or a generated column: the database produces the value.
          const generated = /\bdefault\s+(?:[\w.]+\s*\(|\()|\bgenerated\b|primary key|\bdefault\s+nextval\b/i;
          if (generated.test(trimmed)) selfFilled.add(`${table}.${column[1]}`);
        }
      }
      schema.set(table, columns);
    }

    for (const match of sql.matchAll(/alter table (?:only )?public\.(\w+)([\s\S]*?);/gi)) {
      const [, table, body] = match;
      const columns = schema.get(table);
      if (!columns) continue;
      for (const add of body.matchAll(/add column (?:if not exists )?(\w+)/gi)) columns.add(add[1]);
      // Bare `add <name> <type>`. `column` and `constraint` are the keyword
      // forms handled above and below; capturing them invents a column.
      for (const add of body.matchAll(/^\s*add\s+(\w+)\s+[a-z]/gim)) {
        if (!/^(column|constraint|primary|unique|check|foreign|exclude)$/i.test(add[1])) columns.add(add[1]);
      }
    }
  }
  return schema;
}

async function readWorkflows() {
  const files = (await readdir(WORKFLOWS)).filter((f) => f.endsWith('.json')).sort();
  return await Promise.all(
    files.map(async (file) => ({ file, workflow: JSON.parse(await readFile(path.join(WORKFLOWS, file), 'utf8')) })),
  );
}

/** 1. Every path the app posts to must exist as a webhook, with auth on. */
function checkWebhookPaths(workflows, clientSource) {
  const declared = [...clientSource.matchAll(/^\s*(\w+):\s*'webhook\/([^']+)'/gm)].map((m) => ({
    name: m[1],
    path: m[2],
  }));

  if (declared.length === 0) {
    problems.push('client.ts declares no webhook paths — the regex or the file changed shape.');
    return;
  }

  const offered = new Map();
  for (const { file, workflow } of workflows) {
    for (const node of workflow.nodes) {
      if (node.type !== 'n8n-nodes-base.webhook') continue;
      offered.set(node.parameters?.path, { file, node });
    }
  }

  for (const { name, path: webhookPath } of declared) {
    const match = offered.get(webhookPath);
    if (!match) {
      problems.push(`app posts to '${webhookPath}' (${name}) but no workflow serves that path`);
      continue;
    }
    if (match.node.parameters?.authentication !== 'headerAuth') {
      problems.push(`${match.file}: webhook '${webhookPath}' is not header-authenticated`);
    }
    notes.push(`${name} -> ${match.file} (${match.node.parameters?.responseMode})`);
  }
}

/** 2. Every field the app sends must be read by the workflow that receives it. */
async function checkPayloadFields(workflows) {
  const routes = [
    { file: 'src/app/api/agent-turn/route.ts', webhook: 'norra/agent-turn' },
    { file: 'src/app/api/kb-ingest/route.ts', webhook: 'norra/kb-ingest' },
    { file: 'src/app/api/voice/turn/route.ts', webhook: 'norra/voice-turn' },
  ];

  for (const route of routes) {
    let source;
    try {
      source = await readFile(path.join(APP, route.file), 'utf8');
    } catch {
      problems.push(`${route.file} is missing`);
      continue;
    }

    // Brace matching rather than a regex for the closing brace: the two routes
    // format the call differently, and an end-anchored pattern silently matched
    // only one of them.
    const start = source.indexOf('callN8nWebhook(');
    const open = start === -1 ? -1 : source.indexOf('{', start);
    if (open === -1) {
      problems.push(`${route.file}: could not find the webhook payload`);
      continue;
    }
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) {
      problems.push(`${route.file}: the webhook payload is not balanced`);
      continue;
    }
    const payload = source.slice(open + 1, close);
    // Both `key: value` and the shorthand `key,` — the shorthand form was being
    // skipped, so two agent-turn fields went unchecked.
    const sent = [...payload.matchAll(/^\s+(\w+)\s*[:,]/gm)].map((m) => m[1]);
    if (sent.length === 0) {
      problems.push(`${route.file}: the webhook payload has no fields`);
      continue;
    }

    const entry = workflows.find(({ workflow }) =>
      workflow.nodes.some((n) => n.parameters?.path === route.webhook),
    );
    if (!entry) continue;

    const read = new Set();
    for (const node of entry.workflow.nodes) {
      for (const assignment of node.parameters?.assignments?.assignments ?? []) {
        for (const found of String(assignment.value).matchAll(/body\?\.(\w+)/g)) read.add(found[1]);
      }
    }

    for (const field of sent) {
      if (!read.has(field)) {
        problems.push(`${route.file} sends '${field}' but ${entry.file} never reads it`);
      }
    }
  }
}

/** 3. Every table and column a workflow touches must exist. */
function checkColumns(workflows, schema) {
  let checked = 0;

  for (const { file, workflow } of workflows) {
    for (const node of workflow.nodes) {
      const params = node.parameters ?? {};
      const table = params.tableId ?? params.tableName?.value;
      if (typeof table !== 'string' || table === '') continue;

      const columns = schema.get(table);
      if (!columns) {
        problems.push(`${file} / ${node.name}: table '${table}' is not in the schema`);
        continue;
      }

      const referenced = [
        ...(params.fieldsUi?.fieldValues ?? []).map((f) => f.fieldId),
        ...(params.filters?.conditions ?? []).map((c) => c.keyName),
      ].filter(Boolean);

      for (const column of referenced) {
        checked += 1;
        if (!columns.has(column)) {
          problems.push(`${file} / ${node.name}: ${table}.${column} is not in the schema`);
        }
      }
    }
  }
  notes.push(`${checked} column references checked`);
}

/**
 * 4. Every column the app itself names must exist.
 *
 * The workflows were checked from the start; the app was not, and it names just
 * as many columns in `select` lists and `eq` filters. A renamed column there
 * fails at runtime with an empty result rather than an error, which is worse:
 * a phone number that silently stops resolving answers no calls and reports
 * nothing.
 */
async function checkAppColumns(schema) {
  const files = [
    'src/app/api/voice/incoming/route.ts',
    'src/app/api/voice/turn/route.ts',
    'src/app/api/voice/status/route.ts',
    'src/app/api/voice/recording/route.ts',
    'src/app/api/widget/session/route.ts',
    'src/app/api/widget/turn/route.ts',
    'src/app/api/feedback/route.ts',
  ];
  let checked = 0;

  for (const file of files) {
    let source;
    try {
      source = await readFile(path.join(APP, file), 'utf8');
    } catch {
      problems.push(`${file} is missing`);
      continue;
    }

    // Walk the chained calls in order, so each select and filter is attributed
    // to the `.from(...)` that precedes it.
    let table = null;
    const step = /\.from\('(\w+)'\)|\.select\((`[^`]*`|'[^']*')\)|\.eq\('(\w+)'/g;

    for (const match of source.matchAll(step)) {
      if (match[1]) {
        table = match[1];
        if (!schema.has(table)) problems.push(`${file}: table '${table}' is not in the schema`);
        continue;
      }
      const columns = table ? schema.get(table) : null;
      if (!columns) continue;

      // The quote characters are part of the capture, so strip them before
      // splitting. Filtering out whatever fails to parse is what made an
      // earlier version of this check pass on a column that did not exist:
      // the last name in a list always carried the closing quote and was
      // silently dropped. Anything unparseable is now a problem, not a skip.
      const named = match[2]
        ? match[2]
            .slice(1, -1)
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [match[3]];

      for (const column of named) {
        checked += 1;
        if (!/^\w+$/.test(column)) {
          problems.push(`${file}: could not read the column name '${column}' on ${table}`);
          continue;
        }
        if (!columns.has(column)) {
          problems.push(`${file}: ${table}.${column} is not in the schema`);
        }
      }
    }
  }
  notes.push(`${checked} app column references checked`);
}

/**
 * 5. Every column without a default needs something that writes it.
 *
 * A column nothing writes answers with null or its default forever, and a
 * screen reading it shows a blank that looks like real data. That is how
 * `agent_test_runs.tools_used` sat empty on every run while the page dutifully
 * rendered it — the bug is invisible from either side alone.
 *
 * Reserved columns are listed below with the reason. The list is meant to be
 * short and to shrink; adding to it is a decision, not a way past the check.
 */
const RESERVED = {
  'users.avatar_url': 'no avatar anywhere in the console yet',
  // These four carry a default that *is* the value today. Listed rather than
  // treated as filled, because the day one of them needs to vary the check
  // should say so instead of staying quiet.
  'organizations.settings': 'presentation preferences only; everything a workflow reads became a column',
  'tickets.tags': 'no tagging in the console yet',
  'phone_numbers.provider': "twilio is the only provider, so the default is the value",
  'calls.direction': 'only inbound calls exist; outbound would need its own route',
  'conversations.end_user_email': 'no channel asks a visitor for one yet; the widget is anonymous',
  'conversations.end_user_external_id': 'set once a channel carries a customer id (email, WhatsApp)',
  'messages.tokens_in': 'per-message cost needs agent-turn to report usage',
  'messages.tokens_out': 'as above',
  'messages.latency_ms': 'as above',
  'knowledge_base_documents.source_url': 'for crawled sources; today ingest takes pasted text',
  'knowledge_base_documents.storage_path': 'for file upload; not built',
  'knowledge_base_documents.mime_type': 'as above',
  // The vector store node writes its own columns (content, metadata, embedding)
  // and knows nothing about these. They cannot be filled on the current ingest
  // path at all -- either that path changes or the columns go.
  // Written by the LangChain vector store node, which names no fields for
  // the checker to read. Listed so its absence is a decision, not an oversight.
  'knowledge_base_chunks.embedding': 'written by the vector store node, which declares no field mapping',
  'knowledge_base_chunks.chunk_index': 'the vector store node cannot write it; chunks are unordered today',
  'knowledge_base_chunks.token_count': 'as above',
  'tool_calls_log.message_id': 'would tie a tool call to the turn that caused it; the trace groups by conversation',
  'phone_numbers.provider_sid': 'the number is entered by hand, not provisioned through an API',
};

/**
 * The column names in every object literal handed to insert/update/upsert.
 *
 * Brace matching over the whole argument, not just an object right after the
 * paren: the payload can sit inside a ternary
 * (`.update(done ? { closed_at: stamp } : { ... })`), span lines, and contain
 * its own parentheses. An earlier regex version stopped at the first of those
 * and reported four columns as unwritten that the app writes on every request.
 *
 * Shorthand counts too — `{ checksum, title }` writes both.
 */
function writtenKeys(source) {
  let keys = '';
  for (const call of source.matchAll(/\.(?:insert|update|upsert)\(/g)) {
    const open = call.index + call[0].length - 1;
    const region = balanced(source, open);
    if (region === null) continue;

    // The payload is often built above the call and passed by name, so a
    // literal argument is only one of the two shapes that occur.
    const byName = /^\s*(\w+)\s*[,)]?\s*$/.exec(region);
    if (byName) {
      const declaration = new RegExp(`\\b(?:const|let|var)\\s+${byName[1]}\\s*(?::[^=]+)?=\\s*\\{`).exec(source);
      if (declaration) {
        const body = balanced(source, declaration.index + declaration[0].length - 1);
        if (body !== null) keys += objectKeys(body);
      }
      continue;
    }

    // Every object literal in the argument, each contributing its own keys.
    for (let i = 0; i < region.length; i += 1) {
      if (region[i] !== '{') continue;
      const body = balanced(region, i);
      if (body === null) continue;
      keys += objectKeys(body);
    }
  }
  return keys;
}

/** The text between `source[open]` and its matching close, or null. */
function balanced(source, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char in pairs) depth += 1;
    else if (char === '}' || char === ')' || char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Top-level `key:` and shorthand `key` names of one object body. */
function objectKeys(body) {
  let keys = '';
  let depth = 0;
  let token = '';
  for (let i = 0; i <= body.length; i += 1) {
    const char = body[i];
    if (char === '{' || char === '(' || char === '[') depth += 1;
    else if (char === '}' || char === ')' || char === ']') depth -= 1;

    if (depth === 0 && char !== undefined && /[\w$]/.test(char)) {
      token += char;
      continue;
    }
    if (depth === 0 && token) {
      // `name:` is a key; `name,` or `name}` at the end is shorthand. Anything
      // else (a value, an operator) is not.
      const rest = body.slice(i).trimStart();
      if (rest.startsWith(':') || rest === '' || rest.startsWith(',')) keys += `${token}\n`;
    }
    if (!/[\w$]/.test(char ?? '')) token = '';
  }
  return keys;
}

async function checkWriters(workflows, schema) {
  // What counts as a write: an n8n field mapping, or the object literal handed
  // to insert/update/upsert. A select list deliberately does not count -- that
  // is the difference this check exists to see.
  let written = '';
  for (const { workflow } of workflows) {
    for (const node of workflow.nodes) {
      for (const field of node.parameters?.fieldsUi?.fieldValues ?? []) written += `${field.fieldId}\n`;
    }
  }

  if (APP_PRESENT) {
    for (const file of await sourceFiles(path.join(APP, 'src'))) {
      written += writtenKeys(await readFile(file, 'utf8'));
    }
  }

  // Migrations write too, but only in three shapes. Counting every mention
  // would let an RLS policy or an index name stand in for a writer, which
  // makes the check pass on everything.
  for (const file of (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql'))) {
    const sql = await readFile(path.join(MIGRATIONS, file), 'utf8');
    for (const insert of sql.matchAll(/insert\s+into\s+[\w.]+\s*\(([^)]*)\)/gi)) written += insert[1] + '\n';
    // The table may carry an alias (`update public.documents d set ...`).
    // Without it this missed the trigger that maintains chunk_count, and the
    // check reported a column as unwritten that the database has kept correct
    // since day one.
    for (const update of sql.matchAll(
      /\bupdate\s+(?:only\s+)?[\w."]+(?:\s+(?:as\s+)?(?!set\b)\w+)?\s+set\s+([^;]*?)(?:\bwhere\b|;)/gi,
    )) {
      for (const assign of update[1].matchAll(/(\w+)\s*=/g)) written += assign[1] + '\n';
    }
    for (const trigger of sql.matchAll(/\bnew\.(\w+)\s*(?::=|=[^=])/gi)) written += trigger[1] + '\n';
  }

  let checked = 0;
  const reservedButWritten = [];
  for (const [table, columns] of schema) {
    for (const column of columns) {
      const key = `${table}.${column}`;
      if (selfFilled.has(key)) continue;
      checked += 1;
      if (new RegExp(`\\b${column}\\b`).test(written)) {
        if (key in RESERVED) reservedButWritten.push(key);
        continue;
      }
      if (key in RESERVED) continue;
      problems.push(`${key} has no default and nothing writes it — it will read empty forever`);
    }
  }

  // A reserved entry that is now written is a note gone stale, and a stale note
  // is how the next real one gets waved through.
  for (const key of reservedButWritten) notes.push(`reserved column is written now, drop it from RESERVED: ${key}`);
  notes.push(`${checked} columns checked for a writer`);
}

/** Every .ts/.tsx under a directory, skipping build output. */
async function sourceFiles(dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const [schema, workflows] = await Promise.all([readSchema(), readWorkflows()]);

if (APP_PRESENT) {
  const clientSource = await readFile(CLIENT, 'utf8');
  checkWebhookPaths(workflows, clientSource);
  await checkPayloadFields(workflows);
}
checkColumns(workflows, schema);
if (APP_PRESENT) await checkAppColumns(schema);
await checkWriters(workflows, schema);

console.log(`Schema: ${schema.size} tables, ${[...schema.values()].reduce((n, c) => n + c.size, 0)} columns`);
console.log(`Workflows: ${workflows.length}`);
console.log(APP_PRESENT ? `App: ${APP}` : `App: nicht gefunden unter ${APP} — App-seitige Prüfungen übersprungen`);
for (const note of notes) console.log(`  ${note}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} wiring problem(s):`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log(APP_PRESENT ? '\n✓ App and workflows agree.' : '\n✓ Workflows and schema agree (app checks skipped).');
