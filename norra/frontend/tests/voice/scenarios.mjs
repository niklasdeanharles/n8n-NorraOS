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
import { start as startSupabase, reset, store } from '../mocks/supabase.mjs';
import { start as startN8n } from '../mocks/n8n.mjs';

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
const CAMPAIGN = 'camp-1';
const TARGET = 'target-1';

function seed(overrides = {}) {
  // Die Stimm-Konfiguration hängt am Agenten, alles übrige an der Nummer. Ohne
  // das Auseinandernehmen landete sie in beiden Zeilen, und der Test bewiese
  // nicht mehr, von wo die Route sie tatsächlich liest.
  const { voice_config: voiceConfig = {}, campaign_status: _status, ...numberOverrides } = overrides;
  reset({
    phone_numbers: [{
      id: 'pn-1', organization_id: ORG, e164: NUMBER, label: 'Zentrale', provider: 'twilio',
      agent_id: AGENT, greeting: 'Guten Tag, hier ist Lumen Energie.', voice: 'Polly.Vicki-Neural',
      language: 'de-DE', transfer_number: '+4930999888777', voicemail_message: null,
      max_call_seconds: 600, recording_enabled: false, recording_notice: null,
      business_hours: {}, timezone: 'Europe/Berlin',
      after_hours: 'agent', status: 'active', last_call_at: null, ...numberOverrides,
    }],
    conversations: [], calls: [], messages: [], tickets: [], contacts: [], callbacks: [],
    call_campaigns: [{
      id: CAMPAIGN, organization_id: ORG, name: 'Rückrufe KW38',
      goal: 'Offene Rückrufwünsche abarbeiten.',
      opening_line: 'Guten Tag, hier ist Lumen Energie. Sie hatten um einen Rückruf gebeten.',
      agent_id: AGENT, phone_number_id: 'pn-1',
      status: overrides.campaign_status ?? 'running',
      calling_window: { mon: ['09:00', '17:00'] }, timezone: 'Europe/Berlin',
      max_attempts: 3, retry_after_minutes: 240, max_concurrent: 5,
    }],
    campaign_targets: [{
      id: TARGET, organization_id: ORG, campaign_id: CAMPAIGN, e164: '+4915112345678',
      display_name: 'A. Beispiel', context: {}, outcome: 'pending', attempts: 1,
      next_attempt_at: null, last_attempt_at: null, last_call_id: null, contact_id: null,
    }],
    staff_members: [
      { id: 'staff-1', organization_id: ORG, name: 'Frau Vogel', role: 'Großkunden',
        e164: '+4930111222333', extension: '17', email: 'vogel@lumen.test', note: null,
        accepts_transfers: true, accepts_messages: true, active: true },
      { id: 'staff-2', organization_id: ORG, name: 'Herr Kern', role: 'Geschäftsführung',
        e164: null, extension: '10', email: 'kern@lumen.test', note: null,
        accepts_transfers: false, accepts_messages: true, active: true },
    ],
    messages_for_staff: [],
    phone_departments: [
      { id: 'dep-1', organization_id: ORG, name: 'Buchhaltung', e164: '+493011111111',
        description: 'Rechnungen und Mahnungen', active: true },
      { id: 'dep-2', organization_id: ORG, name: 'Technik', e164: '+493022222222',
        description: 'Stoerungen', active: false },
    ],
    agents: [{
      id: AGENT, organization_id: ORG, name: 'Erstkontakt', status: 'live',
      voice_config: voiceConfig,
    }],
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

// Setzt bewusst auf dem Zustand des vorigen Szenarios auf und ruft deshalb
// kein seed(). Ein Szenario dazwischen bricht es.
await scenario('Wiederholtes Webhook legt nichts doppelt an', async () => {
  await post('/api/voice/incoming', { To: NUMBER, From: '+4917612345678', CallSid: 'CA2' });
  check('weiterhin eine Konversation', store.conversations.length === 1, `sind ${store.conversations.length}`);
  check('weiterhin ein Call', store.calls.length === 1, `sind ${store.calls.length}`);
});

await scenario('Keyterms des Agenten gehen als hints in den Gather', async () => {
  seed({ voice_config: { keyterms: ['Wärmepumpe', 'Abschlagszahlung', 'Zählerstand'] } });
  const res = await post('/api/voice/incoming', { To: NUMBER, From: '+4917612345678', CallSid: 'CA-hints' });
  const xml = await res.text();
  const gather = xml.match(/<Gather[^>]*>/)?.[0] ?? '';
  check('hints am Gather', /hints="/.test(gather), gather);
  // Der Umlaut muss durchkommen: genau die Wörter, an denen sich die Erkennung
  // verhört, tragen ihn. Eine kaputte Kodierung wäre hier ein stiller Ausfall.
  check('Umlaut bleibt erhalten', gather.includes('Wärmepumpe'), gather);
  check('alle drei Begriffe', /hints="[^"]*Abschlagszahlung[^"]*Zählerstand/.test(gather), gather);
});

await scenario('Ohne Keyterms steht kein leeres hints im Gather', async () => {
  seed();
  const res = await post('/api/voice/incoming', { To: NUMBER, From: '+4917612345678', CallSid: 'CA-nohints' });
  const gather = (await res.text()).match(/<Gather[^>]*>/)?.[0] ?? '';
  check('kein hints-Attribut', !gather.includes('hints='), gather);
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

await scenario('Anrufer wird als Kontakt angelegt und beim zweiten Anruf wiedererkannt', async () => {
  seed();
  await post('/api/voice/incoming', { To: NUMBER, From: '+4917612345678', CallSid: 'CD1' });
  check('Kontakt angelegt', store.contacts.length === 1, `sind ${store.contacts.length}`);
  check('Nummer übernommen', store.contacts[0]?.e164 === '+4917612345678');
  check('Konversation zeigt auf den Kontakt', store.conversations[0]?.contact_id === store.contacts[0]?.id);
  check('Anruf zeigt auf den Kontakt', store.calls[0]?.contact_id === store.contacts[0]?.id);

  // Derselbe Anrufer, neuer Anruf: ein Kontakt, zwei gezählte Anrufe. Sonst
  // hätte identify_caller pro Anruf einen neuen "unbekannten" Anrufer.
  await post('/api/voice/incoming', { To: NUMBER, From: '+4917612345678', CallSid: 'CD2' });
  check('kein zweiter Kontakt', store.contacts.length === 1, `sind ${store.contacts.length}`);
  check('call_count erhöht', store.contacts[0]?.call_count === 2, `ist ${store.contacts[0]?.call_count}`);
});

await scenario('Anruf ohne übermittelte Nummer legt keinen Kontakt an', async () => {
  seed();
  // Unterdrückte Rufnummer. Ein Kontakt ohne Nummer wäre eine Karteileiche,
  // die nie wieder jemandem zugeordnet werden kann.
  await post('/api/voice/incoming', { To: NUMBER, From: '', CallSid: 'CD3' });
  check('kein Kontakt', store.contacts.length === 0, `sind ${store.contacts.length}`);
  check('Anruf trotzdem angenommen', store.calls.length === 1);
});

await scenario('Agent stellt zur Abteilung durch', async () => {
  seed();
  n8n = await startN8n(54322, {
    reply: 'Ich verbinde Sie mit der Buchhaltung.', action: 'transfer', transfer_to: 'Buchhaltung',
  });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CD4' });
  const callId = store.calls[0].id;
  const xml = await (await post(`/api/voice/turn?call=${callId}`, { CallSid: 'CD4', SpeechResult: 'Es geht um meine Rechnung.' })).text();
  check('Dial an die Abteilung', xml.includes('+493011111111'), xml.slice(0, 200));
  check('nicht an die Zentrale', !xml.includes('+4930999888777'));
  check('Abteilung im Anruf vermerkt', store.calls[0].ended_reason === 'department:Buchhaltung', String(store.calls[0].ended_reason));
  await n8n.stop();
});

await scenario('Abteilungsname in anderer Schreibweise trifft trotzdem', async () => {
  seed();
  n8n = await startN8n(54322, { reply: 'Einen Moment.', action: 'transfer', transfer_to: 'buchhaltung' });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CD5' });
  const xml = await (await post(`/api/voice/turn?call=${store.calls[0].id}`, { CallSid: 'CD5', SpeechResult: 'Rechnung.' })).text();
  check('Dial an die Abteilung', xml.includes('+493011111111'));
  await n8n.stop();
});

await scenario('Eine erfundene Nummer wird niemals gewählt', async () => {
  seed();
  // Der Kern der Absicherung: das Modell nennt eine Nummer als Abteilungsnamen.
  // Sie steht in keiner Zeile, also darf sie nirgends im TwiML auftauchen.
  n8n = await startN8n(54322, {
    reply: 'Ich verbinde Sie.', action: 'transfer', transfer_to: '+491900666666',
  });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CD6' });
  const xml = await (await post(`/api/voice/turn?call=${store.calls[0].id}`, { CallSid: 'CD6', SpeechResult: 'Weiterleiten.' })).text();
  check('erfundene Nummer nicht gewählt', !xml.includes('+491900666666'), xml.slice(0, 250));
  check('stattdessen die konfigurierte Zentrale', xml.includes('+4930999888777'));
  await n8n.stop();
});

await scenario('Eine pausierte Abteilung nimmt keine Anrufe', async () => {
  seed();
  n8n = await startN8n(54322, { reply: 'Ich verbinde Sie mit der Technik.', action: 'transfer', transfer_to: 'Technik' });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CD7' });
  const xml = await (await post(`/api/voice/turn?call=${store.calls[0].id}`, { CallSid: 'CD7', SpeechResult: 'Störung.' })).text();
  check('nicht an die pausierte Nummer', !xml.includes('+493022222222'), xml.slice(0, 200));
  check('stattdessen die Zentrale', xml.includes('+4930999888777'));
  await n8n.stop();
});

await scenario('Ohne Zentrale und ohne Abteilung endet der Anruf nicht im Nichts', async () => {
  seed({ transfer_number: null });
  n8n = await startN8n(54322, { reply: 'Ich verbinde Sie.', action: 'transfer', transfer_to: 'Vertrieb' });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CD8' });
  const xml = await (await post(`/api/voice/turn?call=${store.calls[0].id}`, { CallSid: 'CD8', SpeechResult: 'Verbinden.' })).text();
  check('kein Dial', !xml.includes('<Dial'), xml.slice(0, 200));
  check('Gespräch läuft weiter', xml.includes('<Gather'));
  check('Konversation eskaliert', store.conversations[0].status === 'escalated', store.conversations[0].status);
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
  // Ein Gespräch ohne einen einzigen Zug hat nichts nachzubereiten. Auf
  // `pending` stehen zu bleiben sähe aus wie eine Nachbereitung, die nie ankam.
  check('Nachbereitung als skipped vermerkt', store.calls[0].wrapup_status === 'skipped', store.calls[0].wrapup_status);
});

await scenario('Nach dem Auflegen wird die Nachbereitung angestoßen', async () => {
  seed();
  n8n = await startN8n(54322, { reply: 'Gern geschehen.', action: 'continue' });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA15' });
  const callId = store.calls[0].id;
  await post(`/api/voice/turn?call=${callId}`, { CallSid: 'CA15', SpeechResult: 'Danke' });
  const before = n8n.seen.length;
  await post('/api/voice/status', { CallSid: 'CA15', CallStatus: 'completed', CallDuration: '31' });

  // Die Route feuert und wartet nicht -- Twilio wiederholt den Callback, wenn
  // er zu lange braucht, und jede Wiederholung wäre eine zweite Nachbereitung.
  // Deshalb hier kurz warten statt zu erwarten, dass es schon passiert ist.
  const deadline = Date.now() + 2000;
  while (n8n.seen.length === before && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const wrapup = n8n.seen.find((entry) => entry.path === '/webhook/norra/call-wrapup');
  check('Wrapup-Webhook gerufen', Boolean(wrapup), n8n.seen.map((e) => e.path).join(', '));
  check('mit dem Header-Auth-Secret', wrapup?.secret === '0123456789abcdef0123');
  // Der Workflow liest beide aus dem Body und filtert damit jede Abfrage. Ohne
  // die Organisations-ID liefe die Nachbereitung ohne Mandantenfilter.
  check('Anruf-ID im Body', wrapup?.body?.call_id === callId, JSON.stringify(wrapup?.body));
  check('Organisations-ID im Body', wrapup?.body?.organization_id === ORG, JSON.stringify(wrapup?.body));
  await n8n.stop();
});

await scenario('Ausgehender Anruf wird angenommen und beginnt mit dem Eröffnungssatz', async () => {
  seed();
  const res = await post(`/api/voice/outbound?target=${TARGET}`, { CallSid: 'CA-out-1', From: NUMBER, To: '+4915112345678' });
  const xml = await res.text();
  check('200', res.status === 200, `bekam ${res.status}`);
  check('Eröffnungssatz gesprochen', xml.includes('Sie hatten um einen Rückruf gebeten.'), xml.slice(0, 200));
  check('Gather auf /api/voice/turn', /<Gather[^>]+action="[^"]*\/api\/voice\/turn\?call=/.test(xml));
  check('Anruf als ausgehend vermerkt', store.calls[0]?.direction === 'outbound', store.calls[0]?.direction);
  check('Ziel am Anruf', store.calls[0]?.campaign_target_id === TARGET);
  check('Konversation ist voice', store.conversations[0]?.channel === 'voice');
  // Ohne diesen Rückverweis fände die Auswertung das Gespräch zum Ziel nicht.
  check('Anruf am Ziel vermerkt', store.campaign_targets[0].last_call_id === store.calls[0]?.id);
});

await scenario('Eine angehaltene Kampagne nimmt kein Gespräch mehr auf', async () => {
  seed({ campaign_status: 'paused' });
  const res = await post(`/api/voice/outbound?target=${TARGET}`, { CallSid: 'CA-out-2', From: NUMBER, To: '+4915112345678' });
  const xml = await res.text();
  // Zwischen Wählen und Abheben liegen Sekunden, in denen jemand auf Pause
  // gedrückt haben kann. Das hier ist der letzte Punkt, an dem das noch zählt.
  check('legt höflich auf', xml.includes('<Hangup/>') && xml.includes('Entschuldigen Sie'), xml.slice(0, 160));
  check('keine Konversation angelegt', store.conversations.length === 0, `sind ${store.conversations.length}`);
  check('kein Anruf angelegt', store.calls.length === 0, `sind ${store.calls.length}`);
});

await scenario('Anrufbeantworter wird erkannt und festgehalten', async () => {
  seed();
  await post(`/api/voice/outbound?target=${TARGET}`, { CallSid: 'CA-out-3', From: NUMBER, To: '+4915112345678' });
  const res = await post(`/api/voice/amd?target=${TARGET}`, { CallSid: 'CA-out-3', AnsweredBy: 'machine_end_beep' });
  check('204', res.status === 204, `bekam ${res.status}`);
  check('am Anruf vermerkt', store.calls[0].answered_by === 'machine', store.calls[0].answered_by);
  // Ein Band ist kein Fehlschlag: die Nummer stimmt, der Zeitpunkt nicht.
  check('Ziel als Anrufbeantworter', store.campaign_targets[0].outcome === 'voicemail', store.campaign_targets[0].outcome);
});

await scenario('Ein Mensch am Hörer ändert am Ziel nichts', async () => {
  seed();
  await post(`/api/voice/outbound?target=${TARGET}`, { CallSid: 'CA-out-4', From: NUMBER, To: '+4915112345678' });
  await post(`/api/voice/amd?target=${TARGET}`, { CallSid: 'CA-out-4', AnsweredBy: 'human' });
  check('am Anruf vermerkt', store.calls[0].answered_by === 'human');
  check('Ziel bleibt offen', store.campaign_targets[0].outcome === 'pending', store.campaign_targets[0].outcome);
});

await scenario('Nach erkanntem Band wird kein Agentenlauf mehr gestartet', async () => {
  seed();
  n8n = await startN8n(54322, { reply: 'Sollte nie gesprochen werden.', action: 'continue' });
  await post(`/api/voice/outbound?target=${TARGET}`, { CallSid: 'CA-out-5', From: NUMBER, To: '+4915112345678' });
  const callId = store.calls[0].id;
  await post(`/api/voice/amd?target=${TARGET}`, { CallSid: 'CA-out-5', AnsweredBy: 'machine_start' });
  const before = n8n.seen.length;
  const res = await post(`/api/voice/turn?call=${callId}`, { CallSid: 'CA-out-5', SpeechResult: 'Piep' });
  const xml = await res.text();
  // Auf ein Band zu sprechen kostet Tokens und Minuten und hinterlässt eine
  // Konversation, die wie ein geführtes Gespräch aussieht.
  check('legt auf', xml.includes('<Hangup/>'), xml.slice(0, 120));
  check('kein Agentenlauf', n8n.seen.length === before, `${n8n.seen.length - before} Aufrufe`);
  check('Grund festgehalten', store.calls[0].ended_reason === 'answering_machine', store.calls[0].ended_reason);
  await n8n.stop();
});

await scenario('Das Tastenfeld nimmt Ziffern an, nicht nur Sprache', async () => {
  seed();
  const res = await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA-dtmf' });
  const gather = (await res.text()).match(/<Gather[^>]*>/)?.[0] ?? '';
  // Eine Kundennummer buchstabiert am Telefon niemand gern, und wer im Zug
  // sitzt, kann oft gar nicht sprechen.
  check('Gather nimmt speech und dtmf', /input="speech dtmf"/.test(gather), gather);
  check('mit Abschlusstaste', /finishOnKey="#"/.test(gather), gather);
});

await scenario('Ohne Ansage wird nichts angekündigt', async () => {
  seed();
  const xml = await (await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA-norec' })).text();
  check('keine Aufnahme-Ansage', !xml.includes('aufgezeichnet'), xml.slice(0, 200));
});

await scenario('Mit Mitschnitt kommt die Ansage vor der Begrüßung', async () => {
  seed({ recording_enabled: true, recording_notice: 'Dieses Gespräch wird aufgezeichnet.' });
  const xml = await (await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA-rec' })).text();
  const notice = xml.indexOf('Dieses Gespräch wird aufgezeichnet.');
  const greeting = xml.indexOf('Guten Tag, hier ist Lumen Energie.');
  check('Ansage vorhanden', notice >= 0, xml.slice(0, 200));
  // Nach dem ersten Satz des Anrufers wäre sie zu spät.
  check('Ansage steht vor der Begrüßung', notice >= 0 && greeting > notice, `${notice} vs ${greeting}`);
});

await scenario('An eine Person durchstellen: Briefing nur für den Mitarbeiter', async () => {
  seed();
  n8n = await startN8n(54322, {
    reply: 'Ich verbinde Sie mit Frau Vogel.',
    action: 'transfer',
    transfer_to_person: 'Frau Vogel',
    briefing: 'Anruf von plus vier neun. Es geht um eine Rechnung.',
  });
  await post('/api/voice/incoming', { To: NUMBER, From: '+4915112345678', CallSid: 'CA-person' });
  const callId = store.calls[0].id;
  const xml = await (await post(`/api/voice/turn?call=${callId}`, { CallSid: 'CA-person', SpeechResult: 'Ich möchte zu Frau Vogel' })).text();

  check('an die Nummer aus dem Verzeichnis', xml.includes('+4930111222333'), xml.slice(0, 300));
  // Der Anrufer wartet im Freizeichen; das Briefing holt Twilio über die URL.
  check('über Number mit Briefing-URL', /<Number url="[^"]*\/api\/voice\/briefing\?call=/.test(xml), xml.slice(0, 300));
  check('Briefing nicht im gesprochenen Text', !xml.includes('Es geht um eine Rechnung'), xml.slice(0, 300));
  check('Briefing an der Anrufzeile', store.calls[0].transfer_briefing === 'Anruf von plus vier neun. Es geht um eine Rechnung.');
  check('als Personen-Transfer vermerkt', store.calls[0].ended_reason === 'person:Frau Vogel', store.calls[0].ended_reason);
  await n8n.stop();
});

await scenario('Die Briefing-Route liest den Satz aus der Zeile, nicht aus der URL', async () => {
  const callId = store.calls[0].id;
  const xml = await (await post(`/api/voice/briefing?call=${callId}`, { CallSid: 'CA-person' })).text();
  check('Briefing wird gesprochen', xml.includes('Es geht um eine Rechnung'), xml);
  check('kein Gather, nur die Ansage', !xml.includes('<Gather'), xml);
});

await scenario('Wer keine Anrufe annimmt, wird nicht durchgestellt', async () => {
  seed();
  n8n = await startN8n(54322, {
    reply: 'Ich verbinde Sie mit Herrn Kern.',
    action: 'transfer',
    transfer_to_person: 'Herr Kern',
  });
  await post('/api/voice/incoming', { To: NUMBER, From: '+49176', CallSid: 'CA-kern' });
  const callId = store.calls[0].id;
  const xml = await (await post(`/api/voice/turn?call=${callId}`, { CallSid: 'CA-kern', SpeechResult: 'Zu Herrn Kern bitte' })).text();
  // Herr Kern hat accepts_transfers = false und gar keine Rufnummer. Statt zu
  // scheitern fällt die Route auf die Zentrale zurück.
  check('nicht an eine erfundene Nummer', !xml.includes('staff-2'), xml.slice(0, 200));
  check('stattdessen die Zentrale', xml.includes('+4930999888777'), xml.slice(0, 200));
  await n8n.stop();
});

console.log(`\n${results.length} Szenarien, ${failures} Fehler`);
supabase.close();
process.exit(failures === 0 ? 0 : 1);
