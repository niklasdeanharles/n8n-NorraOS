/**
 * The phone path, end to end.
 *
 *   node tests/voice/run.mjs
 *
 * Drives the built app over HTTP with real Twilio signatures, against an
 * in-memory stand-in for PostgREST and for the n8n voice workflow. It is not a
 * unit test of the helpers: it exercises the routes as deployed, which is how
 * it caught the middleware redirecting every incoming call to the login page.
 */
import { createHmac } from 'node:crypto';
import { start as startSupabase, reset, store } from './mock-supabase.mjs';
import { start as startN8n } from './mock-n8n.mjs';

const AUTH_TOKEN = 'test-token-0123456789abcdef';
const BASE = 'https://norra.test';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3999';

function sign(url, params) {
  let payload = url;
  for (const key of Object.keys(params).sort()) payload += key + params[key];
  return createHmac('sha1', AUTH_TOKEN).update(Buffer.from(payload, 'utf8')).digest('base64');
}

async function post(path, params, { signed = true } = {}) {
  const publicUrl = `${BASE}${path}`;
  const body = new URLSearchParams(params).toString();
  const response = await fetch(`${APP}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(signed ? { 'x-twilio-signature': sign(publicUrl, params) } : {}),
    },
    body,
  });
  if (process.env.TRACE) {
    console.error(`[${response.status}] ${path} -> ${(await response.clone().text()).slice(0, 160)}`);
  }
  return response;
}

const ORG = 'org-1';
const AGENT = 'agent-1';
const NUMBER = '+4930123456789';

function seed(overrides = {}) {
  reset({
    phone_numbers: [{
      id: 'pn-1', organization_id: ORG, e164: NUMBER, label: 'Zentrale', provider: 'twilio',
      agent_id: AGENT, greeting: 'Guten Tag, hier ist Lumen Energie.', voice: 'Polly.Vicki-Neural',
      language: 'de-DE', transfer_number: '+4930999888777', voicemail_message: null,
      max_call_seconds: 600, recording_enabled: false, business_hours: {}, timezone: 'Europe/Berlin',
      after_hours: 'agent', status: 'active', last_call_at: null, ...overrides,
    }],
    conversations: [], calls: [], messages: [], tickets: [],
    agents: [{ id: AGENT, organization_id: ORG, name: 'Erstkontakt', status: 'live' }],
    organizations: [{ id: ORG, name: 'Lumen Energie' }],
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

// ---------------------------------------------------------------- scenarios
await scenario('Anruf ohne gültige Signatur wird abgewiesen', async () => {
  seed();
  const res = await post('/api/voice/incoming', { To: NUMBER, From: '+4917612345678', CallSid: 'CA1' }, { signed: false });
  check('403 statt TwiML', res.status === 403, `bekam ${res.status}`);
  check('keine Konversation angelegt', store.conversations.length === 0);
});

await scenario('Anruf mit manipulierter Signatur wird abgewiesen', async () => {
  seed();
  const params = { To: NUMBER, From: '+4917612345678', CallSid: 'CA1b' };
  const res = await fetch(`${APP}/api/voice/incoming`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sign(`${BASE}/api/voice/incoming`, { ...params, To: '+49999' }) },
    body: new URLSearchParams(params).toString(),
  });
  check('403', res.status === 403, `bekam ${res.status}`);
});

let n8n;
await scenario('Eingehender Anruf begrüßt und legt Konversation an', async () => {
  seed();
  const res = await post('/api/voice/incoming', { To: NUMBER, From: '+4917612345678', CallSid: 'CA2' });
  const xml = await res.text();
  check('200', res.status === 200, `bekam ${res.status}`);
  check('Begrüßung wird gesprochen', xml.includes('Guten Tag, hier ist Lumen Energie.'));
  check('Stimme und Sprache gesetzt', xml.includes('voice="Polly.Vicki-Neural"') && xml.includes('language="de-DE"'));
  check('Gather auf /api/voice/turn', /<Gather[^>]+action="[^"]*\/api\/voice\/turn\?call=/.test(xml));
  check('Konversation ist voice', store.conversations[0]?.channel === 'voice');
  check('Konversation trägt die CallSid', store.conversations[0]?.external_id === 'CA2');
  check('Call-Zeile angelegt', store.calls.length === 1 && store.calls[0].status === 'in_progress');
  check('last_call_at gesetzt', store.phone_numbers[0].last_call_at !== null);
});

await scenario('Wiederholtes Webhook legt nichts doppelt an', async () => {
  await post('/api/voice/incoming', { To: NUMBER, From: '+4917612345678', CallSid: 'CA2' });
  check('weiterhin eine Konversation', store.conversations.length === 1, `sind ${store.conversations.length}`);
  check('weiterhin ein Call', store.calls.length === 1, `sind ${store.calls.length}`);
});

await scenario('Unbekannte Nummer wird höflich abgewiesen', async () => {
  seed();
  const res = await post('/api/voice/incoming', { To: '+4930000000000', From: '+4917612345678', CallSid: 'CA3' });
  const xml = await res.text();
  check('kein Gather', !xml.includes('<Gather'));
  check('Hangup', xml.includes('<Hangup/>'));
  check('keine Konversation', store.conversations.length === 0);
});

await scenario('Pausierte Nummer nimmt nicht ab', async () => {
  seed({ status: 'paused' });
  const res = await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA4' });
  const xml = await res.text();
  check('Hangup statt Gather', xml.includes('<Hangup/>') && !xml.includes('<Gather'));
});

await scenario('Außerhalb der Zeiten: Weiterleitung', async () => {
  // Closed all week except a window that cannot be "now" for both ends.
  seed({ business_hours: { mon: [['03:00', '03:01']] }, after_hours: 'transfer' });
  const res = await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA5' });
  const xml = await res.text();
  check('Dial an die Weiterleitung', xml.includes('<Dial callerId="+4930123456789">+4930999888777</Dial>'), xml.slice(0, 200));
});

await scenario('Außerhalb der Zeiten: Anruf abweisen', async () => {
  seed({ business_hours: { mon: [['03:00', '03:01']] }, after_hours: 'reject' });
  const res = await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA6' });
  check('Reject', (await res.text()).includes('<Reject'));
});

await scenario('Außerhalb der Zeiten: Anrufbeantworter legt Ticket an', async () => {
  seed({ business_hours: { mon: [['03:00', '03:01']] }, after_hours: 'voicemail', voicemail_message: 'Bitte hinterlassen Sie eine Nachricht.' });
  const res = await post('/api/voice/incoming', { To: NUMBER, From: '+4917612345678', CallSid: 'CA7' });
  const xml = await res.text();
  check('Record-Element', xml.includes('<Record'));
  check('Ansage wird gesprochen', xml.includes('Bitte hinterlassen Sie eine Nachricht.'));

  store.calls.push({ id: 'call-vm', organization_id: ORG, conversation_id: null, agent_id: AGENT, provider_call_id: 'CA7', from_e164: '+4917612345678' });
  const rec = await post('/api/voice/recording', { CallSid: 'CA7', RecordingUrl: 'https://api.twilio.test/RE1' });
  check('Recording quittiert', rec.status === 200);
  check('Ticket angelegt', store.tickets.length === 1, JSON.stringify(store.tickets));
  check('Aufnahme-URL im Ticket', store.tickets[0]?.description?.includes('https://api.twilio.test/RE1'));
  check('Call als voicemail markiert', store.calls.find((c) => c.provider_call_id === 'CA7')?.status === 'voicemail');
});

await scenario('Gesprochener Turn: Agent antwortet', async () => {
  seed();
  n8n = await startN8n(54322, { reply: 'Ihr Abschlag beträgt zweiundneunzig Euro.', action: 'continue' });
  await post('/api/voice/incoming', { To: NUMBER, From: '+4917612345678', CallSid: 'CA8' });
  const callId = store.calls[0].id;

  const res = await post(`/api/voice/turn?call=${callId}`, {
    CallSid: 'CA8', From: '+4917612345678', SpeechResult: 'Wie hoch ist mein Abschlag?',
  });
  const xml = await res.text();
  check('Antwort wird gesprochen', xml.includes('Ihr Abschlag beträgt zweiundneunzig Euro.'));
  check('nächstes Gather', xml.includes('<Gather'));
  check('Frage des Anrufers gespeichert', store.messages.some((m) => m.role === 'user' && m.content === 'Wie hoch ist mein Abschlag?'));
  check('Antwort gespeichert', store.messages.some((m) => m.role === 'assistant'));
  check('turn_count erhöht', store.calls[0].turn_count === 1, `ist ${store.calls[0].turn_count}`);
  check('n8n bekam das Secret', n8n.seen[0]?.secret === '0123456789abcdef0123');
  check('n8n bekam die Organisation', n8n.seen[0]?.body?.organization_id === ORG);
  check('n8n bekam die History', Array.isArray(n8n.seen[0]?.body?.history));
  await n8n.stop();
});

await scenario('Agent eskaliert: Anruf geht an den Menschen', async () => {
  seed();
  n8n = await startN8n(54322, { reply: 'Ich verbinde Sie mit einer Kollegin.', action: 'transfer' });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA9' });
  const callId = store.calls[0].id;
  const xml = await (await post(`/api/voice/turn?call=${callId}`, { CallSid: 'CA9', SpeechResult: 'Ich will einen Menschen sprechen.' })).text();
  check('Dial an die Weiterleitung', xml.includes('<Dial callerId="+4930123456789">+4930999888777</Dial>'));
  check('Call als transferred markiert', store.calls[0].status === 'transferred');
  await n8n.stop();
});

await scenario('Agent antwortet nicht rechtzeitig: Übergabe statt Stille', async () => {
  seed();
  n8n = await startN8n(54322, null); // never responds
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA10' });
  const callId = store.calls[0].id;
  const started = Date.now();
  const xml = await (await post(`/api/voice/turn?call=${callId}`, { CallSid: 'CA10', SpeechResult: 'Hallo?' })).text();
  const elapsed = Date.now() - started;
  check('bricht vor der Anbieter-Grenze ab', elapsed < 15000, `${elapsed}ms`);
  check('leitet weiter statt zu schweigen', xml.includes('<Dial'));
  check('Grund festgehalten', store.calls[0].ended_reason === 'agent_unavailable');
  check('Konversation eskaliert', store.conversations[0].status === 'escalated');
  await n8n.stop();
});

await scenario('Anrufer sagt nichts', async () => {
  seed();
  n8n = await startN8n(54322, { reply: 'x', action: 'continue' });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA11' });
  const callId = store.calls[0].id;
  const first = await (await post(`/api/voice/turn?call=${callId}`, { CallSid: 'CA11', SpeechResult: '' })).text();
  check('fragt einmal nach', first.includes('noch einmal') || first.includes('wiederholen'));
  const second = await (await post(`/api/voice/turn?call=${callId}&silent=1`, { CallSid: 'CA11', SpeechResult: '' })).text();
  check('legt beim zweiten Mal auf', second.includes('<Hangup/>') && !second.includes('<Gather'));
  check('nichts an n8n geschickt', n8n.seen.length === 0);
  await n8n.stop();
});

await scenario('Zeitlimit beendet das Gespräch', async () => {
  seed({ max_call_seconds: 30 });
  n8n = await startN8n(54322, { reply: 'x', action: 'continue' });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA12' });
  const call = store.calls[0];
  call.started_at = new Date(Date.now() - 120_000).toISOString();
  const xml = await (await post(`/api/voice/turn?call=${call.id}`, { CallSid: 'CA12', SpeechResult: 'Und noch etwas' })).text();
  check('legt auf', xml.includes('<Hangup/>'));
  check('Grund festgehalten', call.ended_reason === 'max_duration');
  check('kein weiterer Agentenlauf', n8n.seen.length === 0);
  await n8n.stop();
});

await scenario('Statuscallback schließt den Anruf ab', async () => {
  seed();
  n8n = await startN8n(54322, { reply: 'Gern geschehen.', action: 'continue' });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA13' });
  const callId = store.calls[0].id;
  await post(`/api/voice/turn?call=${callId}`, { CallSid: 'CA13', SpeechResult: 'Danke' });
  const res = await post('/api/voice/status', { CallSid: 'CA13', CallStatus: 'completed', CallDuration: '47' });
  check('204', res.status === 204, `bekam ${res.status}`);
  check('Status completed', store.calls[0].status === 'completed');
  check('Dauer übernommen', store.calls[0].duration_seconds === 47);
  check('Konversation resolved', store.conversations[0].status === 'resolved');
  await n8n.stop();
});

await scenario('Aufgelegt ohne ein Wort zählt nicht als gelöst', async () => {
  seed();
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA14' });
  await post('/api/voice/status', { CallSid: 'CA14', CallStatus: 'completed', CallDuration: '3' });
  check('Konversation closed, nicht resolved', store.conversations[0].status === 'closed', store.conversations[0].status);
});

console.log(`\n${results.length} Szenarien, ${failures} Fehler`);
supabase.close();
process.exit(failures === 0 ? 0 : 1);
