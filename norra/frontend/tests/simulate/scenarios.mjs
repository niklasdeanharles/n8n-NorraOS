/**
 * "Vor dem Start testen", end to end.
 *
 *   node tests/simulate/run.mjs
 *
 * Drives `/api/simulate` on the built app as a signed-in admin, against
 * in-memory stand-ins for PostgREST, GoTrue and the n8n agent-turn webhook.
 *
 * The point of the suite is the tool assertion. `expect_tool` sat in the
 * schema, was selected by the runner and never checked, so a case demanding a
 * tool passed no matter what the agent did. A green test that proves nothing
 * is worse than a missing one, and only an end-to-end run catches that class
 * of bug: every layer in isolation looked fine.
 */
import { start as startSupabase, reset, store } from '../mocks/supabase.mjs';
import { start as startN8n } from '../mocks/n8n.mjs';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3999';

const ORG = '00000000-0000-4000-8000-00000000a001';
const AGENT = '00000000-0000-4000-8000-00000000a002';
const ADMIN = '00000000-0000-4000-8000-00000000a003';
const MEMBER = '00000000-0000-4000-8000-00000000a004';

const ADMIN_USER = { id: ADMIN, aud: 'authenticated', email: 'admin@lumen.test' };

/**
 * A session cookie the app accepts.
 *
 * `@supabase/ssr` derives its cookie name from the first label of the Supabase
 * host — `127.0.0.1` gives `sb-127-auth-token` — and `getUser()` validates the
 * token against GoTrue rather than trusting the cookie, so the mock's
 * `/auth/v1/user` decides who is signed in. The cookie only has to exist and
 * parse.
 */
const SESSION_COOKIE = `sb-127-auth-token=${encodeURIComponent(
  JSON.stringify({
    access_token: 'test-access-token',
    token_type: 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'test-refresh-token',
    user: ADMIN_USER,
  }),
)}`;

async function simulate({ agentId = AGENT, signedIn = true } = {}) {
  const response = await fetch(`${APP}/api/simulate`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(signedIn ? { cookie: SESSION_COOKIE } : {}),
    },
    body: JSON.stringify({ agentId }),
  });
  if (process.env.TRACE) {
    console.error(`[${response.status}] /api/simulate -> ${(await response.clone().text()).slice(0, 200)}`);
  }
  return response;
}

function seed(cases, { role = 'admin' } = {}) {
  reset(
    {
      organizations: [{ id: ORG, name: 'Lumen Energie' }],
      users: [
        { id: ADMIN, organization_id: ORG, role, full_name: 'Alex Admin', email: 'admin@lumen.test' },
        { id: MEMBER, organization_id: ORG, role: 'agent', full_name: 'Mika Agent', email: 'agent@lumen.test' },
      ],
      agents: [{ id: AGENT, organization_id: ORG, name: 'Erstkontakt', status: 'live', tools: ['escalate_to_human'] }],
      agent_test_cases: cases.map((testCase, index) => ({
        id: `00000000-0000-4000-8000-0000000000${String(index + 10).padStart(2, '0')}`,
        organization_id: ORG,
        agent_id: AGENT,
        expect_contains: [],
        expect_absent: [],
        expect_tool: null,
        created_at: new Date(Date.now() + index).toISOString(),
        ...testCase,
      })),
      conversations: [],
      messages: [],
      tool_calls_log: [],
      agent_test_runs: [],
      audit_log: [],
    },
    ADMIN_USER,
  );
}

/** Acts like a tool sub-workflow: logs the call, then lets the agent answer. */
function replyAfterCalling(toolName, text) {
  return (_count, body) => {
    if (toolName) {
      store.tool_calls_log.push({
        id: `tc-${store.tool_calls_log.length + 1}`,
        organization_id: body.organization_id,
        conversation_id: body.conversation_id,
        agent_id: body.agent_id,
        tool_name: toolName,
        status: 'success',
        created_at: new Date().toISOString(),
      });
    }
    return text;
  };
}

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

const results = [];
async function scenario(name, fn) {
  console.log(`\n${name}`);
  await fn();
  results.push(name);
}

const supabase = await startSupabase(54321);
let n8n = null;
const stopN8n = async () => {
  if (n8n) await n8n.stop();
  n8n = null;
};

// ---------------------------------------------------------------- scenarios

await scenario('Ohne Anmeldung läuft keine Simulation', async () => {
  seed([{ name: 'Gruß', input: 'Hallo', expect_contains: ['Hallo'] }]);
  n8n = await startN8n(54322, 'sollte nie aufgerufen werden');
  const res = await simulate({ signedIn: false });
  check('nicht 200', res.status !== 200, `bekam ${res.status}`);
  check('n8n wurde nicht aufgerufen', n8n.seen.length === 0);
  check('kein Lauf protokolliert', store.agent_test_runs.length === 0);
  await stopN8n();
});

await scenario('Ein Nicht-Admin darf nicht simulieren', async () => {
  seed([{ name: 'Gruß', input: 'Hallo', expect_contains: ['Hallo'] }], { role: 'agent' });
  n8n = await startN8n(54322, 'sollte nie aufgerufen werden');
  const res = await simulate();
  check('403', res.status === 403, `bekam ${res.status}`);
  check('n8n wurde nicht aufgerufen', n8n.seen.length === 0);
  await stopN8n();
});

await scenario('Ein Agent ohne Testfälle wird nicht stillschweigend grün', async () => {
  seed([]);
  n8n = await startN8n(54322, 'egal');
  const res = await simulate();
  check('400', res.status === 400, `bekam ${res.status}`);
  check('n8n wurde nicht aufgerufen', n8n.seen.length === 0);
  await stopN8n();
});

await scenario('Textprüfungen laufen weiter wie zuvor', async () => {
  seed([
    { name: 'Muss Ticket nennen', input: 'Ich brauche Hilfe', expect_contains: ['Ticket'] },
    { name: 'Darf nichts zusagen', input: 'Bekomme ich Geld zurück?', expect_absent: ['wurde erstattet'] },
  ]);
  n8n = await startN8n(54322, (count) =>
    count === 1 ? 'Ich lege ein Ticket an.' : 'Der Betrag wurde erstattet.',
  );
  const res = await simulate();
  const body = await res.json();
  check('200', res.status === 200, `bekam ${res.status}`);
  check('einer von zwei bestanden', body.passed === 1 && body.total === 2, JSON.stringify(body));
  check('der zweite ist rot', body.results[1].status === 'failed');
  check(
    'nennt die verbotene Zeichenfolge',
    body.results[1].failures.join(' ').includes('wurde erstattet'),
    JSON.stringify(body.results[1].failures),
  );
  await stopN8n();
});

await scenario('Ein erwartetes Tool, das gerufen wurde, besteht', async () => {
  seed([{ name: 'Eskaliert', input: 'Ich will einen Menschen', expect_tool: 'escalate_to_human' }]);
  n8n = await startN8n(54322, replyAfterCalling('escalate_to_human', 'Ich verbinde Sie, Ticket #17.'));
  const res = await simulate();
  const body = await res.json();
  check('bestanden', body.passed === 1 && body.total === 1, JSON.stringify(body));
  check('Tool im Ergebnis', body.results[0].toolsUsed.includes('escalate_to_human'));
  check('Tool im Lauf gespeichert', store.agent_test_runs[0]?.tools_used?.includes('escalate_to_human'));
  await stopN8n();
});

// This is the regression. Before the fix the answer text alone decided, so a
// model that says it opened a ticket without opening one passed.
await scenario('Behauptet, ein Ticket angelegt zu haben, ruft aber kein Tool: rot', async () => {
  seed([{ name: 'Eskaliert', input: 'Ich will einen Menschen', expect_tool: 'escalate_to_human' }]);
  n8n = await startN8n(54322, 'Ich habe ein Ticket angelegt und verbinde Sie.');
  const res = await simulate();
  const body = await res.json();
  check('durchgefallen', body.passed === 0 && body.total === 1, JSON.stringify(body));
  check(
    'nennt das fehlende Tool',
    body.results[0].failures.join(' ').includes('escalate_to_human'),
    JSON.stringify(body.results[0].failures),
  );
  check('kein Tool protokolliert', store.agent_test_runs[0]?.tools_used?.length === 0);
  await stopN8n();
});

await scenario('Ein falsches Tool erfüllt die Erwartung nicht', async () => {
  seed([{ name: 'Eskaliert', input: 'Ich will einen Menschen', expect_tool: 'escalate_to_human' }]);
  n8n = await startN8n(54322, replyAfterCalling('request_action', 'Ich reiche das zur Freigabe ein.'));
  const res = await simulate();
  const body = await res.json();
  check('durchgefallen', body.passed === 0, JSON.stringify(body));
  check(
    'nennt beide Tools',
    body.results[0].failures.join(' ').includes('escalate_to_human') &&
      body.results[0].failures.join(' ').includes('request_action'),
    JSON.stringify(body.results[0].failures),
  );
  await stopN8n();
});

// All cases share one scratch conversation, so its rows have to be attributed
// by identity. Attributing them by timestamp would let clock skew between this
// process and the database hand case two the tool call from case one.
await scenario('Der zweite Fall erbt den Tool-Aufruf des ersten nicht', async () => {
  seed([
    { name: 'Eskaliert', input: 'Ich will einen Menschen', expect_tool: 'escalate_to_human' },
    { name: 'Eskaliert auch', input: 'Nochmal bitte', expect_tool: 'escalate_to_human' },
  ]);
  n8n = await startN8n(54322, (count, body) =>
    count === 1 ? replyAfterCalling('escalate_to_human', 'Ticket #18.')(count, body) : 'Kann ich nicht.',
  );
  const res = await simulate();
  const body = await res.json();
  check('erster grün', body.results[0].status === 'passed', JSON.stringify(body.results[0]));
  check('zweiter rot', body.results[1].status === 'failed', JSON.stringify(body.results[1]));
  check('zweiter ohne Tool', body.results[1].toolsUsed.length === 0, JSON.stringify(body.results[1].toolsUsed));
  await stopN8n();
});

await scenario('Text- und Tool-Erwartung gelten gemeinsam', async () => {
  seed([
    {
      name: 'Eskaliert und nennt die Nummer',
      input: 'Ich will einen Menschen',
      expect_tool: 'escalate_to_human',
      expect_contains: ['Ticket'],
    },
  ]);
  n8n = await startN8n(54322, replyAfterCalling('escalate_to_human', 'Ich kümmere mich darum.'));
  const res = await simulate();
  const body = await res.json();
  check('durchgefallen trotz Tool-Aufruf', body.passed === 0, JSON.stringify(body));
  check('Tool erfüllt', !body.results[0].failures.join(' ').includes('escalate_to_human'));
  check('Text fehlt', body.results[0].failures.join(' ').includes('Ticket'));
  await stopN8n();
});

await scenario('Ein Fehler von n8n macht den Fall rot, nicht den Lauf kaputt', async () => {
  seed([
    { name: 'Erster', input: 'A', expect_contains: ['A'] },
    { name: 'Zweiter', input: 'B', expect_contains: ['B'] },
  ]);
  let calls = 0;
  n8n = await startN8n(54322, () => {
    calls += 1;
    if (calls === 1) throw new Error('kaputt');
    return 'B';
  });
  const res = await simulate();
  const body = await res.json();
  check('200 trotz Fehler', res.status === 200, `bekam ${res.status}`);
  check('erster als error', body.results[0].status === 'error', JSON.stringify(body.results[0]));
  check('zweiter lief trotzdem', body.results[1].status === 'passed', JSON.stringify(body.results[1]));
  await stopN8n();
});

await scenario('Die Simulation hinterlässt keine Konversation im Posteingang', async () => {
  seed([{ name: 'Gruß', input: 'Hallo', expect_contains: ['Hallo'] }]);
  n8n = await startN8n(54322, 'Hallo!');
  await simulate();
  check('Scratch-Konversation gelöscht', store.conversations.length === 0, JSON.stringify(store.conversations));
  check('keine Tool-Zeile übrig', store.tool_calls_log.length === 0);
  check('Lauf bleibt erhalten', store.agent_test_runs.length === 1);
  check('Audit-Eintrag geschrieben', store.audit_log.length === 1);
  await stopN8n();
});

await scenario('Ein fremder Agent liefert 404', async () => {
  seed([{ name: 'Gruß', input: 'Hallo', expect_contains: ['Hallo'] }]);
  n8n = await startN8n(54322, 'sollte nie aufgerufen werden');
  const res = await simulate({ agentId: '00000000-0000-4000-8000-0000000000ff' });
  check('404', res.status === 404, `bekam ${res.status}`);
  check('n8n wurde nicht aufgerufen', n8n.seen.length === 0);
  await stopN8n();
});

// ------------------------------------------------------------------- result
await stopN8n();
supabase.close();
console.log(`\n${results.length} Szenarien, ${failures} Fehler`);
process.exit(failures === 0 ? 0 : 1);
