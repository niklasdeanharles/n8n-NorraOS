/**
 * The two authenticated console routes, end to end.
 *
 *   node tests/console/run.mjs
 *
 * `/api/agent-turn` is the path the operator's own chat takes, and
 * `/api/kb-ingest` the one every knowledge document takes. Both write before
 * they call n8n, and both have failure branches — a duplicate document, an
 * unreachable workflow — that only show up under a real HTTP round trip.
 *
 * What this suite deliberately does NOT prove: tenant isolation. `agent-turn`
 * leans entirely on RLS to scope a conversation, and the mock has no RLS, so
 * an assertion here that another tenant's id returns 404 would be green
 * whatever the route did. That guarantee is proven where it is real, against a
 * live Postgres, in supabase/tests/tenancy.test.sql.
 */
import { start as startSupabase, reset, store, setUser } from '../mocks/supabase.mjs';
import { start as startN8n } from '../mocks/n8n.mjs';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3996';

const ORG = '00000000-0000-4000-8000-00000000b001';
const AGENT = '00000000-0000-4000-8000-00000000b002';
const ADMIN = '00000000-0000-4000-8000-00000000b003';
const CONVERSATION = '00000000-0000-4000-8000-00000000b004';
const ORPHAN = '00000000-0000-4000-8000-00000000b005';

const ADMIN_USER = { id: ADMIN, aud: 'authenticated', email: 'admin@lumen.test' };

/** See tests/simulate/scenarios.mjs for why this cookie is enough. */
const SESSION_COOKIE = `sb-127-auth-token=${encodeURIComponent(
  JSON.stringify({
    access_token: 'test-access-token',
    token_type: 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'test-refresh-token',
    user: ADMIN_USER,
  }),
)}`;

async function post(path, body, { signedIn = true, raw = null } = {}) {
  const response = await fetch(`${APP}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(signedIn ? { cookie: SESSION_COOKIE } : {}) },
    body: raw ?? JSON.stringify(body),
  });
  if (process.env.TRACE) {
    console.error(`[${response.status}] ${path} -> ${(await response.clone().text()).slice(0, 200)}`);
  }
  return response;
}

function seed({ role = 'admin', messages = [], documents = [] } = {}) {
  reset(
    {
      organizations: [{ id: ORG, name: 'Lumen Energie' }],
      users: [{ id: ADMIN, organization_id: ORG, role, full_name: 'Alex Admin', email: 'admin@lumen.test' }],
      agents: [{ id: AGENT, organization_id: ORG, name: 'Erstkontakt', status: 'live' }],
      conversations: [
        { id: CONVERSATION, organization_id: ORG, agent_id: AGENT, channel: 'web', status: 'open' },
        // A conversation with no agent: the 409 branch.
        { id: ORPHAN, organization_id: ORG, agent_id: null, channel: 'web', status: 'open' },
      ],
      messages,
      knowledge_base_documents: documents,
      knowledge_base_chunks: [],
      tickets: [],
      tool_calls_log: [],
      audit_log: [],
    },
    ADMIN_USER,
  );
}

/** `seq` decides history order, so the fixtures have to carry it. */
function priorMessages(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
    organization_id: ORG,
    conversation_id: CONVERSATION,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Nachricht ${i + 1}`,
    seq: i + 1,
  }));
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

// ------------------------------------------------------------- agent-turn

await scenario('Ein Turn ohne Anmeldung wird abgewiesen', async () => {
  seed();
  n8n = await startN8n(54322, 'sollte nie aufgerufen werden');
  const res = await post('/api/agent-turn', { conversationId: CONVERSATION, message: 'Hallo' }, { signedIn: false });
  check('nicht 200', res.status !== 200, `bekam ${res.status}`);
  check('nichts gespeichert', store.messages.length === 0);
  check('n8n nicht aufgerufen', n8n.seen.length === 0);
  await stopN8n();
});

await scenario('Eine leere Nachricht erreicht den Agenten nicht', async () => {
  seed();
  n8n = await startN8n(54322, 'sollte nie aufgerufen werden');
  const res = await post('/api/agent-turn', { conversationId: CONVERSATION, message: '   ' });
  check('400', res.status === 400, `bekam ${res.status}`);
  check('nichts gespeichert', store.messages.length === 0);
  check('n8n nicht aufgerufen', n8n.seen.length === 0);
  await stopN8n();
});

await scenario('Kaputtes JSON ist 400, kein 500', async () => {
  seed();
  n8n = await startN8n(54322, 'x');
  const res = await post('/api/agent-turn', null, { raw: '{nicht json' });
  check('400', res.status === 400, `bekam ${res.status}`);
  await stopN8n();
});

await scenario('Eine unbekannte Konversation ist 404', async () => {
  seed();
  n8n = await startN8n(54322, 'sollte nie aufgerufen werden');
  const res = await post('/api/agent-turn', {
    conversationId: '00000000-0000-4000-8000-0000000000ff',
    message: 'Hallo',
  });
  check('404', res.status === 404, `bekam ${res.status}`);
  check('n8n nicht aufgerufen', n8n.seen.length === 0);
  await stopN8n();
});

await scenario('Eine Konversation ohne Agent bricht ab, statt n8n zu rufen', async () => {
  seed();
  n8n = await startN8n(54322, 'sollte nie aufgerufen werden');
  const res = await post('/api/agent-turn', { conversationId: ORPHAN, message: 'Hallo' });
  check('409', res.status === 409, `bekam ${res.status}`);
  check('nichts gespeichert', store.messages.length === 0);
  check('n8n nicht aufgerufen', n8n.seen.length === 0);
  await stopN8n();
});

await scenario('Ein Turn speichert die Nachricht und streamt die Antwort zurück', async () => {
  seed();
  n8n = await startN8n(54322, 'Guten Tag, wie kann ich helfen?');
  const res = await post('/api/agent-turn', { conversationId: CONVERSATION, message: 'Hallo' });
  const text = await res.text();
  check('200', res.status === 200, `bekam ${res.status}`);
  check('Antwort durchgereicht', text.includes('Guten Tag'), text.slice(0, 80));
  check('Pufferung abgeschaltet', res.headers.get('x-accel-buffering') === 'no');
  check('Nachricht gespeichert', store.messages.length === 1 && store.messages[0].content === 'Hallo');
  check('als user gespeichert', store.messages[0]?.role === 'user');
  await stopN8n();
});

// The payload's tenancy comes from the conversation row, never from the body.
// A route that echoed a body field here would hand n8n whatever a caller
// claimed, and n8n runs with service_role, which bypasses RLS entirely.
await scenario('n8n bekommt Organisation und Agent aus der Konversation', async () => {
  seed();
  n8n = await startN8n(54322, 'ok');
  await post('/api/agent-turn', {
    conversationId: CONVERSATION,
    message: 'Hallo',
    organization_id: 'fremde-org',
    agent_id: 'fremder-agent',
  });
  const sent = n8n.seen[0]?.body ?? {};
  check('organization_id aus der Zeile', sent.organization_id === ORG, JSON.stringify(sent.organization_id));
  check('agent_id aus der Zeile', sent.agent_id === AGENT, JSON.stringify(sent.agent_id));
  check('Secret mitgeschickt', typeof n8n.seen[0]?.secret === 'string' && n8n.seen[0].secret.length > 0);
  await stopN8n();
});

await scenario('Die Historie kommt ältestes zuerst und enthält den neuen Turn', async () => {
  seed({ messages: priorMessages(3) });
  n8n = await startN8n(54322, 'ok');
  await post('/api/agent-turn', { conversationId: CONVERSATION, message: 'Vierte' });
  const history = n8n.seen[0]?.body?.history ?? [];
  check('vier Einträge', history.length === 4, `bekam ${history.length}`);
  check('ältestes zuerst', history[0]?.content === 'Nachricht 1', JSON.stringify(history[0]));
  check('neuester zuletzt', history.at(-1)?.content === 'Vierte', JSON.stringify(history.at(-1)));
  await stopN8n();
});

await scenario('Die Historie ist bei 20 Turns gedeckelt', async () => {
  seed({ messages: priorMessages(30) });
  n8n = await startN8n(54322, 'ok');
  await post('/api/agent-turn', { conversationId: CONVERSATION, message: 'Neueste' });
  const history = n8n.seen[0]?.body?.history ?? [];
  check('höchstens 20', history.length === 20, `bekam ${history.length}`);
  check('die jüngsten, nicht die ältesten', history.at(-1)?.content === 'Neueste', JSON.stringify(history.at(-1)));
  await stopN8n();
});

await scenario('Ein Fehler aus n8n wird nicht an den Browser weitergereicht', async () => {
  seed();
  n8n = await startN8n(54322, () => {
    throw new Error('workflow secret: interner Knotenname');
  });
  const res = await post('/api/agent-turn', { conversationId: CONVERSATION, message: 'Hallo' });
  const text = await res.text();
  check('502', res.status === 502, `bekam ${res.status}`);
  check('kein Workflow-Interna im Body', !text.includes('interner Knotenname'), text.slice(0, 120));
  check('Nachricht bleibt gespeichert', store.messages.length === 1);
  await stopN8n();
});

await scenario('Ist n8n gar nicht erreichbar, gibt es 502 statt eines Absturzes', async () => {
  seed();
  const res = await post('/api/agent-turn', { conversationId: CONVERSATION, message: 'Hallo' });
  check('502', res.status === 502, `bekam ${res.status}`);
});

// -------------------------------------------------------------- kb-ingest

await scenario('Ein Nicht-Admin darf die Wissensbasis nicht befüllen', async () => {
  seed({ role: 'agent' });
  n8n = await startN8n(54322, 'sollte nie aufgerufen werden');
  const res = await post('/api/kb-ingest', { title: 'Rückgabe', content: 'Text' });
  check('403', res.status === 403, `bekam ${res.status}`);
  check('kein Dokument angelegt', store.knowledge_base_documents.length === 0);
  check('n8n nicht aufgerufen', n8n.seen.length === 0);
  await stopN8n();
});

await scenario('Ein Dokument entsteht als pending und geht dann an n8n', async () => {
  seed();
  n8n = await startN8n(54322, { ok: true });
  const res = await post('/api/kb-ingest', { title: 'Rückgaberichtlinie', content: 'Vierzehn Tage.' });
  const body = await res.json();
  check('202', res.status === 202, `bekam ${res.status}`);
  check('documentId zurückgegeben', typeof body.documentId === 'string');
  check('Zeile angelegt', store.knowledge_base_documents.length === 1);
  check('Checksumme gesetzt', typeof store.knowledge_base_documents[0]?.checksum === 'string');
  check('n8n bekam den Text', n8n.seen[0]?.body?.content === 'Vierzehn Tage.');
  check('n8n bekam die document_id', n8n.seen[0]?.body?.document_id === body.documentId);
  await stopN8n();
});

// The checksum index is the only thing standing between a re-submit and a
// second full set of chunks for text that has not changed.
await scenario('Dasselbe Dokument ein zweites Mal ist 409, kein zweiter Ingest', async () => {
  seed();
  n8n = await startN8n(54322, { ok: true });
  await post('/api/kb-ingest', { title: 'Rückgabe', content: 'Vierzehn Tage.' });
  const res = await post('/api/kb-ingest', { title: 'Rückgabe erneut', content: 'Vierzehn Tage.' });
  check('409', res.status === 409, `bekam ${res.status}`);
  check('nur ein Dokument', store.knowledge_base_documents.length === 1);
  check('nur ein Ingest-Lauf', n8n.seen.length === 1, `${n8n.seen.length} Läufe`);
  await stopN8n();
});

await scenario('Geänderter Text darf erneut hinein', async () => {
  seed();
  n8n = await startN8n(54322, { ok: true });
  await post('/api/kb-ingest', { title: 'Rückgabe', content: 'Vierzehn Tage.' });
  const res = await post('/api/kb-ingest', { title: 'Rückgabe', content: 'Dreißig Tage.' });
  check('202', res.status === 202, `bekam ${res.status}`);
  check('zwei Dokumente', store.knowledge_base_documents.length === 2);
  await stopN8n();
});

// A vanished upload looks to the operator like it never happened; a failed one
// says what went wrong.
await scenario('Scheitert der Ingest, bleibt das Dokument als failed sichtbar', async () => {
  seed();
  n8n = await startN8n(54322, () => {
    throw new Error('Einbettung nicht verfügbar');
  });
  const res = await post('/api/kb-ingest', { title: 'Rückgabe', content: 'Vierzehn Tage.' });
  check('502', res.status === 502, `bekam ${res.status}`);
  check('Zeile bleibt', store.knowledge_base_documents.length === 1);
  check('Status failed', store.knowledge_base_documents[0]?.status === 'failed');
  check('Grund festgehalten', typeof store.knowledge_base_documents[0]?.error === 'string');
  await stopN8n();
});

await scenario('Ein zu langes Dokument wird abgelehnt', async () => {
  seed();
  n8n = await startN8n(54322, { ok: true });
  const res = await post('/api/kb-ingest', { title: 'Riesig', content: 'x'.repeat(500_001) });
  check('400', res.status === 400, `bekam ${res.status}`);
  check('nichts angelegt', store.knowledge_base_documents.length === 0);
  check('n8n nicht aufgerufen', n8n.seen.length === 0);
  await stopN8n();
});

// ------------------------------------------------------------------ result
await stopN8n();
supabase.close();
console.log(`\n${results.length} Szenarien, ${failures} Fehler`);
process.exit(failures === 0 ? 0 : 1);
