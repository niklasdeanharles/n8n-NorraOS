#!/usr/bin/env node
/**
 * Builds the app against the mocks, starts it, runs the simulation scenarios.
 *
 * The build step is not optional: `NEXT_PUBLIC_*` is inlined at build time, so
 * an app built against the real Supabase URL would quietly talk to it instead
 * of the mock. The Supabase host also decides the session cookie's name, so
 * `scenarios.mjs` and this file have to agree on it.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

// The app is the repository root here; `tests/` sits beside `src/`.
const APP = path.resolve(import.meta.dirname, '../..');
const PORT = process.env.PORT ?? '3997';

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-for-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-test',
  N8N_WEBHOOK_URL: 'http://127.0.0.1:54322',
  N8N_WEBHOOK_SECRET: '0123456789abcdef0123',
  TWILIO_AUTH_TOKEN: 'test-token-0123456789abcdef',
  NORRA_PUBLIC_URL: 'https://norra.test',
};

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

console.log('--- Build gegen die Mocks ---');
await run('npm', ['run', 'build'], { cwd: APP, env });

// `npx next start` forks a `next-server` grandchild that outlives a plain
// `child.kill()` on the wrapper -- a prior run left exactly that behind,
// still bound to the port, and every run after it hung forever waiting for a
// build the OS never let start. Running it in its own process group (Unix
// only; this suite is Node, not Windows) makes the negative-pid kill below
// take the whole tree with it.
try {
  await run('fuser', ['-k', `${PORT}/tcp`], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 500));
} catch {
  // fuser exits non-zero when nothing was listening, which is the common case.
}

const app = spawn('npx', ['next', 'start', '-p', PORT], { cwd: APP, env, stdio: 'inherit', detached: true });

function stopApp() {
  try {
    process.kill(-app.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

let ready = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/login`);
    ready = true;
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
if (!ready) {
  stopApp();
  console.error('app kam nicht hoch');
  process.exit(1);
}

let code = 1;
try {
  await run('node', ['scenarios.mjs'], {
    cwd: import.meta.dirname,
    env: { ...env, APP_URL: `http://127.0.0.1:${PORT}` },
  });
  code = 0;
} catch {
  code = 1;
} finally {
  stopApp();
}
process.exit(code);
