#!/usr/bin/env node
/**
 * Builds the app against the mocks, starts it, runs the call scenarios.
 *
 * The build step is not optional: `NEXT_PUBLIC_*` is inlined at build time, so
 * an app built against the real Supabase URL would quietly talk to it instead
 * of the mock — which looked exactly like a broken lookup for half an hour.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP = path.join(ROOT, 'app');
const PORT = process.env.PORT ?? '3999';

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

const app = spawn('npx', ['next', 'start', '-p', PORT], { cwd: APP, env, stdio: 'inherit' });

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
  app.kill();
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
  app.kill();
}
process.exit(code);
