/**
 * The web widget path, end to end.
 *
 * Drives the built app over HTTP exactly as an embedded iframe would: mint a
 * session for an agent id, then post turns with the token that session
 * returns. No signature scheme here — the trust boundary is the HMAC token
 * itself, so a chunk of this suite is dedicated to what happens when it is
 * tampered with, expired, or points at an agent that goes dark mid-chat.
 */
import { start as startSupabase, reset, store } from '../mocks/supabase.mjs';
import { start as startN8n } from '../mocks/n8n.mjs';
import { createHmac } from 'node:crypto';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3999';

async function post(path, body, headers = {}) {
  return await fetch(`${APP}${path}`, {
    method: 'POST',
    // x-forwarded-for ist das, was die Plattform vorne anhaengt; die Route
    // liest den linkesten Eintrag. Ohne ihn teilen sich alle Szenarien einen
    // Zaehler und das dritte faellt ueber das zweite.
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.1', ...headers },
    body: JSON.stringify(body),
  });
}

let addressCounter = 0;
/** Eine Adresse, die noch kein Szenario verbraucht hat. */
function freshAddress() {
  addressCounter += 1;
  return `198.51.100.${addressCounter}`;
}

// The widget API validates these as real UUIDs (unlike the Twilio form
// fields the voice routes read), so the fixtures have to look like one.
const ORG = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';

function seed(agentOverrides = {}) {
  reset({
    agents: [{
      id: AGENT, organization_id: ORG, name: 'Erstkontakt', status: 'live',
      channels: ['web'], ...agentOverrides,
    }],
    conversations: [], messages: [], organizations: [{ id: ORG, name: 'Lumen Energie' }],
    rate_limits: [],
  });
}

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
}

const results = [];
async function scenario(name, fn) {
  console.log(`\n${name}`);
  await fn();
  results.push(name);
}

const supabase = await startSupabase(54321);
let n8n;

await scenario('Session für einen unbekannten Agenten wird abgelehnt', async () => {
  seed();
  const res = await post('/api/widget/session', { agentId: '00000000-0000-4000-8000-000000009999' });
  check('404', res.status === 404, `bekam ${res.status}`);
});

await scenario('Session für einen Entwurfs-Agenten wird abgelehnt', async () => {
  seed({ status: 'draft' });
  const res = await post('/api/widget/session', { agentId: AGENT });
  check('404', res.status === 404, `bekam ${res.status}`);
});

await scenario('Session für einen Agenten ohne Web-Kanal wird abgelehnt', async () => {
  seed({ channels: ['voice'] });
  const res = await post('/api/widget/session', { agentId: AGENT });
  check('404', res.status === 404, `bekam ${res.status}`);
});

let token;
let conversationId;
await scenario('Session für einen live Web-Agenten startet eine Konversation', async () => {
  seed();
  const res = await post('/api/widget/session', { agentId: AGENT });
  check('200', res.status === 200, `bekam ${res.status}`);
  const data = await res.json();
  check('liefert eine Konversations-ID', typeof data.conversationId === 'string');
  check('liefert ein Token', typeof data.token === 'string' && data.token.includes('.'));
  check('liefert den Agentennamen', data.agentName === 'Erstkontakt');
  check('Konversation ist channel web', store.conversations[0]?.channel === 'web');
  token = data.token;
  conversationId = data.conversationId;
});

await scenario('Eine erneute Session mit derselben Konversations-ID setzt sie fort', async () => {
  const res = await post('/api/widget/session', { agentId: AGENT, conversationId });
  const data = await res.json();
  check('dieselbe Konversation', data.conversationId === conversationId);
  check('weiterhin nur eine Konversation', store.conversations.length === 1, `sind ${store.conversations.length}`);
});

await scenario('Ein Turn mit gültigem Token streamt die Antwort und persistiert beides', async () => {
  n8n = await startN8n(54322, { reply: 'Der Assistent antwortet.' });
  const res = await post('/api/widget/turn', { token, message: 'Wie hoch ist mein Abschlag?' });
  check('200', res.status === 200, `bekam ${res.status}`);
  const body = await res.text();
  check('Body enthält die n8n-Antwort', body.includes('Der Assistent antwortet.'), body);
  check('liefert ein aufgefrischtes Token', res.headers.get('x-norra-widget-token')?.includes('.'));
  check('CORS offen für Iframe-Einbettung', res.headers.get('access-control-allow-origin') === '*');
  check('Kundenfrage gespeichert', store.messages.some((m) => m.role === 'user' && m.content === 'Wie hoch ist mein Abschlag?'));
  check('n8n bekam die Organisation aus dem Token, nicht aus dem Body', n8n.seen[0]?.body?.organization_id === ORG);
  check('n8n bekam den Agenten aus dem Token', n8n.seen[0]?.body?.agent_id === AGENT);
  await n8n.stop();
});

await scenario('Ein manipuliertes Token wird abgelehnt', async () => {
  const [body] = token.split('.');
  const tampered = `${body}.${'A'.repeat(43)}`;
  const res = await post('/api/widget/turn', { token: tampered, message: 'Hallo?' });
  check('401', res.status === 401, `bekam ${res.status}`);
});

await scenario('Ein Token für eine fremde Konversation wird nicht angenommen', async () => {
  // Forges a payload with a real signature over a *different* conversation id
  // than the one the visitor actually holds -- the closest a client-side
  // attacker gets to choosing their own tenant.
  const [, realSignature] = token.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({ c: 'not-a-real-conversation', o: ORG, a: AGENT, e: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const res = await post('/api/widget/turn', { token: `${forgedPayload}.${realSignature}`, message: 'Hallo?' });
  // The signature no longer matches this payload, so this must fail exactly
  // like a garbled token -- not succeed against the forged conversation id.
  check('401, nicht 200 gegen die erfundene Konversation', res.status === 401, `bekam ${res.status}`);
});

/**
 * Reproduces lib/widget/token.ts's own signing so this test can mint a
 * genuinely valid-but-expired token, rather than a garbled one that would
 * fail for the wrong reason. The secret is the one this suite's own run.mjs
 * puts in the environment before starting the app -- not a value the app
 * exposes anywhere.
 */
function signWidgetToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', `widget:${process.env.N8N_WEBHOOK_SECRET}`).update(body).digest('base64url');
  return `${body}.${signature}`;
}

await scenario('Ein abgelaufenes, aber korrekt signiertes Token wird abgelehnt', async () => {
  const [body] = token.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  payload.e = Math.floor(Date.now() / 1000) - 10;
  const expired = signWidgetToken(payload);
  const res = await post('/api/widget/turn', { token: expired, message: 'Hallo?' });
  check('401', res.status === 401, `bekam ${res.status}`);
});

await scenario('Agent wird mitten im Gespräch auf Entwurf gesetzt: der nächste Turn stoppt', async () => {
  seed();
  n8n = await startN8n(54322, { reply: 'x' });
  const sessionRes = await post('/api/widget/session', { agentId: AGENT });
  const session = await sessionRes.json();

  store.agents[0].status = 'draft';
  const res = await post('/api/widget/turn', { token: session.token, message: 'Noch da?' });
  check('404 statt eine Antwort von einem deaktivierten Agenten', res.status === 404, `bekam ${res.status}`);
  check('n8n wurde nicht aufgerufen', n8n.seen.length === 0);
  await n8n.stop();
});

await scenario('Die Nachrichten-Obergrenze pro Konversation greift', async () => {
  seed();
  n8n = await startN8n(54322, { reply: 'x' });
  const sessionRes = await post('/api/widget/session', { agentId: AGENT });
  const session = await sessionRes.json();
  for (let i = 0; i < 400; i += 1) {
    store.messages.push({ id: `seed-${i}`, conversation_id: session.conversationId, role: 'user', content: 'x' });
  }
  const res = await post('/api/widget/turn', { token: session.token, message: 'Noch eine?' });
  check('429', res.status === 429, `bekam ${res.status}`);
  check('kein weiterer Agentenlauf', n8n.seen.length === 0);
  await n8n.stop();
});

await scenario('Eine Bewertung wird einmalig übernommen', async () => {
  seed();
  const sessionRes = await post('/api/widget/session', { agentId: AGENT });
  const session = await sessionRes.json();

  const first = await post('/api/feedback', { token: session.token, rating: 5 });
  check('200', first.status === 200, `bekam ${first.status}`);
  check('csat gespeichert', store.conversations[0]?.csat === 5);

  const second = await post('/api/feedback', { token: session.token, rating: 1 });
  check('409 bei erneuter Bewertung', second.status === 409, `bekam ${second.status}`);
  check('csat bleibt bei der ersten Bewertung', store.conversations[0]?.csat === 5);
});

await scenario('Eine Bewertung mit manipuliertem Token wird abgelehnt', async () => {
  seed();
  const sessionRes = await post('/api/widget/session', { agentId: AGENT });
  const session = await sessionRes.json();
  const [body] = session.token.split('.');
  const res = await post('/api/feedback', { token: `${body}.${'C'.repeat(43)}`, rating: 5 });
  check('401', res.status === 401, `bekam ${res.status}`);
  check('csat bleibt leer', store.conversations[0]?.csat == null);
});

// ---------------------------------------------------------------------------
// Domain-Bindung
// ---------------------------------------------------------------------------

await scenario('Ohne Domain-Liste darf jede Seite einbetten', async () => {
  seed();
  const res = await post('/api/widget/session', { agentId: AGENT },
    { origin: 'https://irgendwer.de', 'x-forwarded-for': freshAddress() });
  check('200', res.status === 200, `bekam ${res.status}`);
});

await scenario('Mit Domain-Liste kommt nur die eingetragene Seite durch', async () => {
  seed({ allowed_origins: ['https://kunde.de'] });
  const ok = await post('/api/widget/session', { agentId: AGENT },
    { origin: 'https://kunde.de', 'x-forwarded-for': freshAddress() });
  check('eigene Domain: 200', ok.status === 200, `bekam ${ok.status}`);

  const fremd = await post('/api/widget/session', { agentId: AGENT },
    { origin: 'https://fremde-seite.de', 'x-forwarded-for': freshAddress() });
  // Dasselbe 404 wie ein Agent, den es nicht gibt: ein eigener Fehler wuerde
  // dem Sondierenden bestaetigen, dass die Agent-ID stimmt.
  check('fremde Domain: 404', fremd.status === 404, `bekam ${fremd.status}`);
  check('keine Konversation angelegt', store.conversations.length === 1, `sind ${store.conversations.length}`);
});

await scenario('Eine Subdomain ist nicht dieselbe Domain', async () => {
  seed({ allowed_origins: ['https://kunde.de'] });
  const res = await post('/api/widget/session', { agentId: AGENT },
    { origin: 'https://shop.kunde.de', 'x-forwarded-for': freshAddress() });
  check('404', res.status === 404, `bekam ${res.status}`);
});

await scenario('Ohne Origin-Header kommt eine beschränkte Domain nicht durch', async () => {
  seed({ allowed_origins: ['https://kunde.de'] });
  // Ein Browser sendet Origin bei jedem Cross-Origin-POST. Fehlt er, ist der
  // Aufrufer kein Browser -- und bei einem beschraenkten Agenten kein Gast.
  const res = await post('/api/widget/session', { agentId: AGENT }, { 'x-forwarded-for': freshAddress() });
  check('404', res.status === 404, `bekam ${res.status}`);
});

// ---------------------------------------------------------------------------
// Grenzen
// ---------------------------------------------------------------------------

await scenario('Zu viele Sitzungen von einer Adresse werden abgewiesen', async () => {
  seed();
  const address = freshAddress();
  const codes = [];
  for (let i = 0; i < 12; i += 1) {
    const res = await post('/api/widget/session', { agentId: AGENT }, { 'x-forwarded-for': address });
    codes.push(res.status);
  }
  check('die ersten zehn kommen durch', codes.slice(0, 10).every((c) => c === 200), codes.join(','));
  check('danach 429', codes.slice(10).every((c) => c === 429), codes.join(','));
  check('nur zehn Konversationen angelegt', store.conversations.length === 10, `sind ${store.conversations.length}`);
});

await scenario('Eine andere Adresse ist von der Grenze unberührt', async () => {
  seed();
  const busy = freshAddress();
  for (let i = 0; i < 11; i += 1) await post('/api/widget/session', { agentId: AGENT }, { 'x-forwarded-for': busy });
  const other = await post('/api/widget/session', { agentId: AGENT }, { 'x-forwarded-for': freshAddress() });
  check('200', other.status === 200, `bekam ${other.status}`);
});

await scenario('Zu viele Turns auf einem Token werden abgewiesen', async () => {
  seed();
  n8n = await startN8n(54322, 'Kurz.');
  const session = await (await post('/api/widget/session', { agentId: AGENT },
    { 'x-forwarded-for': freshAddress() })).json();

  const codes = [];
  for (let i = 0; i < 17; i += 1) {
    const res = await post('/api/widget/turn', { token: session.token, message: `Frage ${i}` });
    codes.push(res.status);
    if (res.body) await res.text();
  }
  check('die ersten fünfzehn kommen durch', codes.slice(0, 15).every((c) => c === 200), codes.join(','));
  check('danach 429', codes.slice(15).every((c) => c === 429), codes.join(','));
  // Der Punkt der Uebung: was nicht durchkommt, kostet auch nichts.
  check('n8n wurde nur fünfzehnmal gerufen', n8n.seen.length === 15, `waren ${n8n.seen.length}`);
  await n8n.stop();
});

console.log(`\n${results.length} Szenarien, ${failures} Fehler`);
supabase.close();
process.exit(failures === 0 ? 0 : 1);
