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

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKFLOWS = path.join(ROOT, 'n8n-workflows');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const CLIENT = path.join(ROOT, 'app/src/lib/n8n/client.ts');

const problems = [];
const notes = [];

/** Table -> Set(columns), assembled from CREATE TABLE and ALTER TABLE ADD COLUMN. */
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
        }
      }
      schema.set(table, columns);
    }

    for (const match of sql.matchAll(/alter table (?:only )?public\.(\w+)([\s\S]*?);/gi)) {
      const [, table, body] = match;
      const columns = schema.get(table);
      if (!columns) continue;
      for (const add of body.matchAll(/add column (?:if not exists )?(\w+)/gi)) columns.add(add[1]);
      for (const add of body.matchAll(/^\s*add\s+(\w+)\s+[a-z]/gim)) columns.add(add[1]);
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
    { file: 'app/src/app/api/agent-turn/route.ts', webhook: 'norra/agent-turn' },
    { file: 'app/src/app/api/kb-ingest/route.ts', webhook: 'norra/kb-ingest' },
    { file: 'app/src/app/api/voice/turn/route.ts', webhook: 'norra/voice-turn' },
  ];

  for (const route of routes) {
    let source;
    try {
      source = await readFile(path.join(ROOT, route.file), 'utf8');
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
    'app/src/app/api/voice/incoming/route.ts',
    'app/src/app/api/voice/turn/route.ts',
    'app/src/app/api/voice/status/route.ts',
    'app/src/app/api/voice/recording/route.ts',
    'app/src/app/api/widget/session/route.ts',
    'app/src/app/api/widget/turn/route.ts',
  ];
  let checked = 0;

  for (const file of files) {
    let source;
    try {
      source = await readFile(path.join(ROOT, file), 'utf8');
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

const [schema, workflows, clientSource] = await Promise.all([
  readSchema(),
  readWorkflows(),
  readFile(CLIENT, 'utf8'),
]);

checkWebhookPaths(workflows, clientSource);
await checkPayloadFields(workflows);
checkColumns(workflows, schema);
await checkAppColumns(schema);

console.log(`Schema: ${schema.size} tables, ${[...schema.values()].reduce((n, c) => n + c.size, 0)} columns`);
console.log(`Workflows: ${workflows.length}`);
for (const note of notes) console.log(`  ${note}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} wiring problem(s):`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log('\n✓ App and workflows agree.');
