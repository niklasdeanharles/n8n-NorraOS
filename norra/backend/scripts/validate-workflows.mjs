#!/usr/bin/env node
/**
 * Pre-flight check for the workflow files, run before deploy touches the API.
 *
 * This used to be a bash loop in the workflow YAML, and it failed twice over:
 * `for file in *.json` stopped matching anything when the files moved into
 * `webhooks/` and `sub-workflows/`, and an unmatched glob in bash is not an
 * error -- the literal pattern is passed through, so the step reported a
 * confusing module-not-found instead of "no files". A check that can quietly
 * check nothing is worse than no check.
 *
 * Lives here rather than in the YAML so it can be run locally:
 *
 *   node scripts/validate-workflows.mjs
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DIR = path.resolve(import.meta.dirname, '../n8n-workflows');

const files = [];
for (const entry of await readdir(DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  for (const name of await readdir(path.join(DIR, entry.name))) {
    if (name.endsWith('.json')) files.push(`${entry.name}/${name}`);
  }
}
files.sort();

// The one thing the old check could not say.
if (files.length === 0) {
  console.error(`No workflow files under ${DIR}. Did the layout change?`);
  process.exit(1);
}

const problems = [];
let claimed = 0;

for (const file of files) {
  let workflow;
  try {
    workflow = JSON.parse(await readFile(path.join(DIR, file), 'utf8'));
  } catch (error) {
    problems.push(`${file}: not valid JSON -- ${error.message}`);
    continue;
  }

  if (!workflow.name) problems.push(`${file}: no name`);
  if (!Array.isArray(workflow.nodes)) problems.push(`${file}: no nodes array`);
  if (!workflow.connections) problems.push(`${file}: no connections`);

  // A missing workflowId is a legitimate state, not a fault: deploy never
  // creates, so a new file waits until it has been imported once. n8n-sync
  // skips it with a warning, and failing here would contradict that.
  if (workflow.norra?.workflowId) {
    claimed += 1;
    console.log(`  ok       ${file}`);
  } else {
    console.log(`  wartet   ${file}  (noch keine norra.workflowId -- wird beim Deploy übersprungen)`);
  }
}

console.log(`\n${files.length} Datei(en), ${claimed} mit Workflow-ID.`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
