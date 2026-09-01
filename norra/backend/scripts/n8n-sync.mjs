#!/usr/bin/env node
/**
 * Syncs Norra's n8n workflows between the instance and this repository.
 *
 *   node scripts/n8n-sync.mjs export [--dry-run]
 *   node scripts/n8n-sync.mjs deploy [--dry-run]
 *
 * n8n's native Git environments are Enterprise-only, so this covers the same
 * ground over the public REST API.
 *
 * Two safety rules hold this together:
 *
 *   export only looks at workflows whose name starts with NAME_PREFIX. The
 *   instance hosts unrelated workflows and none of them belong in this repo.
 *
 *   deploy only writes to ids a repo file explicitly claims in its `norra`
 *   block. It never creates and never deletes, so a bad file can at worst
 *   damage a workflow the repo already owns.
 *
 * Requires N8N_BASE_URL and N8N_API_KEY.
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const WORKFLOW_DIR = path.resolve(import.meta.dirname, '../n8n-workflows');
// The en dash matters: the instance also hosts "Norra OS 1", "Norra AI Phone
// Agent" and "Norra Sales-Team", none of which belong in this repository. A
// looser prefix would sweep them into the backup.
const NAME_PREFIX = 'Norra \u2013 ';

/** The only fields the n8n public API accepts on PUT. Anything else is a 400. */
const WRITABLE_FIELDS = ['name', 'nodes', 'connections', 'settings'];

/**
 * Fields the API returns that change on their own between reads. Keeping them
 * would make every backup run produce a diff and bury real changes.
 */
const VOLATILE_FIELDS = [
  'id', 'active', 'createdAt', 'updatedAt', 'versionId', 'activeVersionId',
  'triggerCount', 'tags', 'pinData', 'shared', 'isArchived', 'scopes',
  'canExecute', 'homeProject', 'sharedWithProjects', 'parentFolderId',
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Both N8N_BASE_URL and N8N_API_KEY are required.`);
  }
  return value;
}

async function api(pathname, init = {}) {
  const base = requireEnv('N8N_BASE_URL').replace(/\/+$/, '');
  const response = await fetch(`${base}/api/v1${pathname}`, {
    ...init,
    headers: {
      'X-N8N-API-KEY': requireEnv('N8N_API_KEY'),
      'content-type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method ?? 'GET'} ${pathname} failed: ${response.status} ${body.slice(0, 400)}`);
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

function slugify(name) {
  return (
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workflow'
  );
}

/** Strips volatile fields so an unchanged workflow round-trips to an identical file. */
function normalize(workflow, bookkeeping) {
  const clean = { ...workflow };
  for (const field of VOLATILE_FIELDS) delete clean[field];
  // Ordered so a diff opens on the name rather than a wall of nodes.
  return {
    name: clean.name,
    nodes: clean.nodes ?? [],
    connections: clean.connections ?? {},
    settings: clean.settings ?? {},
    ...(clean.meta ? { meta: clean.meta } : {}),
    norra: bookkeeping,
  };
}

/**
 * Workflows are filed one folder deep by what starts them: `webhooks/` for the
 * ones n8n exposes over HTTP, `sub-workflows/` for the ones another workflow
 * calls. `name` carries that folder, so it stays the file's identity.
 */
async function readRepoWorkflows() {
  const files = [];
  for (const dir of (await readdir(WORKFLOW_DIR, { withFileTypes: true })).filter((e) => e.isDirectory())) {
    for (const entry of await readdir(path.join(WORKFLOW_DIR, dir.name))) {
      if (!entry.endsWith('.json')) continue;
      const name = `${dir.name}/${entry}`;
      const file = path.join(WORKFLOW_DIR, name);
      files.push({ file, name, workflow: JSON.parse(await readFile(file, 'utf8')) });
    }
  }
  return files;
}

/**
 * Where a workflow the repo has never seen belongs. A webhook node means the
 * outside world calls it; anything else is started by another workflow.
 */
function folderFor(workflow) {
  const webhook = (workflow.nodes ?? []).some((node) => node.type === 'n8n-nodes-base.webhook');
  return webhook ? 'webhooks' : 'sub-workflows';
}

async function runExport({ dryRun }) {
  const repoFiles = await readRepoWorkflows();
  // Existing files own their filename, so a rename upstream does not orphan them.
  const filenameById = new Map(
    repoFiles
      .filter((f) => f.workflow.norra?.workflowId)
      .map((f) => [f.workflow.norra.workflowId, f.name]),
  );

  const summaries = (await listWorkflows()).filter((w) => (w.name ?? '').startsWith(NAME_PREFIX));
  console.log(`Found ${summaries.length} workflow(s) named "${NAME_PREFIX}…" on the instance.`);

  let written = 0;
  for (const summary of summaries) {
    const full = await api(`/workflows/${summary.id}`);
    const filename = filenameById.get(summary.id) ?? `${folderFor(full)}/${slugify(summary.name)}.json`;
    const slug = path.basename(filename, '.json');
    const normalized = normalize(full, { workflowId: summary.id, slug });
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;

    const target = path.join(WORKFLOW_DIR, filename);
    let previous = null;
    try {
      previous = await readFile(target, 'utf8');
    } catch {
      // New workflow; there is nothing to compare against.
    }

    if (previous === serialized) {
      console.log(`  unchanged  ${filename}`);
      continue;
    }
    console.log(`  ${previous === null ? 'new      ' : 'changed  '}  ${filename}  (${summary.name})`);
    if (!dryRun) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, serialized);
    }
    written += 1;
  }

  console.log(dryRun ? `\n${written} file(s) would change.` : `\n${written} file(s) written.`);
}

/**
 * Credential references live on the instance, not in the repo. A file that
 * omits them must not strip them from the running workflow, so they are carried
 * over from whatever is live.
 */
function carryOverCredentials(repoNodes, liveNodes) {
  const liveByName = new Map((liveNodes ?? []).map((node) => [node.name, node]));
  const preserved = [];

  const merged = (repoNodes ?? []).map((node) => {
    if (node.credentials) return node;
    const live = liveByName.get(node.name);
    if (!live?.credentials) return node;
    preserved.push(node.name);
    return { ...node, credentials: live.credentials };
  });

  return { nodes: merged, preserved };
}

async function runDeploy({ dryRun }) {
  const repoFiles = await readRepoWorkflows();
  const claimed = repoFiles.filter((f) => f.workflow.norra?.workflowId);
  const unclaimed = repoFiles.filter((f) => !f.workflow.norra?.workflowId);

  for (const file of unclaimed) {
    console.warn(`  skipped    ${file.name}  (no norra.workflowId -- deploy never creates workflows)`);
  }

  // Every claimed id is resolved before anything is written. Failing halfway
  // through would leave the instance holding some new workflows and some old
  // ones, which is worse than not deploying at all.
  const resolved = [];
  const missing = [];
  for (const { name, workflow } of claimed) {
    const id = workflow.norra.workflowId;
    try {
      resolved.push({ name, workflow, id, live: await api(`/workflows/${id}`) });
    } catch (error) {
      missing.push(`  ${name} claims ${id}: ${error.message}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      'Deploy aborted before writing anything. Deploy never creates workflows, ' +
      `so these ids must already exist on the instance:\n${missing.join('\n')}`,
    );
  }

  let deployed = 0;
  for (const { name, workflow, id, live } of resolved) {
    const { nodes, preserved } = carryOverCredentials(workflow.nodes, live.nodes);
    const payload = {};
    for (const field of WRITABLE_FIELDS) {
      if (workflow[field] !== undefined) payload[field] = workflow[field];
    }
    payload.nodes = nodes;

    if (preserved.length > 0) {
      console.log(`  ${name}: kept live credentials for ${preserved.join(', ')}`);
    }

    if (dryRun) {
      console.log(`  would push ${name} -> ${id} (${live.name})`);
      continue;
    }

    await api(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    console.log(`  pushed     ${name} -> ${id} (${live.name})`);
    deployed += 1;
  }

  console.log(dryRun ? '\nDry run; nothing was written.' : `\n${deployed} workflow(s) pushed.`);
}

const [command, ...rest] = process.argv.slice(2);
const dryRun = rest.includes('--dry-run');

try {
  if (command === 'export') await runExport({ dryRun });
  else if (command === 'deploy') await runDeploy({ dryRun });
  else {
    console.error('Usage: n8n-sync.mjs <export|deploy> [--dry-run]');
    process.exit(2);
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
