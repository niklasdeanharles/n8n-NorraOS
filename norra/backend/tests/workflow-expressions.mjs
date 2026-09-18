#!/usr/bin/env node
/**
 * Die Ausdrücke in den Workflows, gegen echte Daten ausgewertet.
 *
 *   node tests/workflow-expressions.mjs
 *
 * Warum das nötig ist: `check-wiring.mjs` prüft, dass ein Workflow die
 * richtigen Tabellen und Spalten *nennt*. Was zwischen `{{` und `}}` steht,
 * ist für es eine Zeichenkette. Genau dort liegt aber die Logik, die ein
 * Kunde zu spüren bekommt — welches Schema das Modell befüllt, was in die
 * Wissensbasis gerät, ob ein Zeitpunkt geraten wird.
 *
 * Diese Suite lädt die Workflow-JSONs, zieht die Ausdrücke heraus und führt
 * sie mit gestellten Daten aus. Sie ersetzt keinen Lauf auf der Instanz; sie
 * fängt die Klasse Fehler, die dort erst auffällt, wenn ein Kunde in der
 * Leitung ist.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const load = (file) => JSON.parse(readFileSync(path.join(ROOT, 'n8n-workflows', file), 'utf8'));
const nodesOf = (workflow) => Object.fromEntries(workflow.nodes.map((node) => [node.name, node]));

let failures = 0;
let checks = 0;
function check(label, ok, detail = '') {
  checks += 1;
  if (ok) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
}
function group(name) { console.log(`\n${name}`); }

/**
 * Wertet einen n8n-Ausdruck aus, der den ganzen Wert ausmacht (`={{ … }}`).
 *
 * Textinterpolation mit mehreren `{{ }}` in einem Satz ist hier nicht der
 * Prüfgegenstand: dort steckt keine Entscheidung, nur Formatierung.
 */
function evaluate(expression, context) {
  const body = String(expression).replace(/^=/, '');
  const match = body.match(/^\{\{([\s\S]*)\}\}$/);
  if (!match) return null;
  const $ = (name) => ({ item: { json: context.nodes[name] ?? {} } });
  return new Function('$', '$json', 'DateTime', `return (${match[1]});`)(
    $, context.json ?? {}, context.DateTime ?? MiniDateTime,
  );
}

/**
 * Führt den JavaScript-Code eines Code-Nodes aus.
 *
 * Ein Ausdruck ist eine Zeile, ein Code-Node ein kleines Programm mit
 * Verzweigungen — und in einer davon steht bei `lookup_order`, was ein Anrufer
 * zu hören bekommt und was nicht. Diese Klasse Fehler fällt sonst erst dann
 * auf, wenn sie schon jemandem vorgelesen wurde.
 */
function runCode(node, { items = [], nodes = {} } = {}) {
  const wrapped = items.map((json) => ({ json }));
  const $input = { all: () => wrapped, first: () => wrapped[0] };
  const $ = (name) => ({ first: () => ({ json: nodes[name] ?? {} }), item: { json: nodes[name] ?? {} } });
  return new Function('$input', '$', node.parameters.jsCode)($input, $);
}

/** Nur was die Ausdrücke brauchen. Luxon selbst ist hier keine Abhängigkeit wert. */
const MiniDateTime = {
  fromISO(raw) {
    const date = new Date(raw);
    const valid = !Number.isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(String(raw));
    return {
      isValid: valid,
      toISO: () => (valid ? date.toISOString() : null),
      plus: ({ minutes }) => ({ toISO: () => new Date(date.getTime() + minutes * 60000).toISOString() }),
    };
  },
};

const assignment = (node, name) =>
  node.parameters.assignments.assignments.find((entry) => entry.name === name).value;
const field = (node, id) =>
  node.parameters.fieldsUi.fieldValues.find((entry) => entry.fieldId === id).fieldValue;

// ---------------------------------------------------------------------------
// call-wrapup: das Extraktionsschema entsteht zur Laufzeit
// ---------------------------------------------------------------------------

{
  const wrapup = nodesOf(load('webhooks/call-wrapup.json'));
  const nodes = {
    'Load Agent': { voice_config: {
      extract: [
        { name: 'order_id', prompt: 'Die Bestellnummer, falls genannt.' },
        { name: 'anliegen', prompt: 'Das Anliegen in drei Wörtern.' },
      ],
      followup: { target: 'email', address: 'ops@kunde.de' },
      webhook: { url: 'https://kunde.de/norra' },
    } },
    'Extract From Call': { output: { summary: 'Kunde fragte nach BX-4471.', order_id: 'BX-4471', anliegen: 'Lieferstatus' } },
  };

  group('call-wrapup: Extraktionsschema');
  const schema = JSON.parse(evaluate(assignment(wrapup['Plan Wrapup'], 'schema'), { nodes }));
  check('Objekt-Schema', schema.type === 'object');
  check('summary ist Pflicht', JSON.stringify(schema.required) === '["summary"]');
  check('beide konfigurierten Felder', 'order_id' in schema.properties && 'anliegen' in schema.properties);
  check('Beschreibung wandert mit', schema.properties.order_id.description === 'Die Bestellnummer, falls genannt.');

  group('call-wrapup: wann überhaupt nachbereitet wird');
  const hasWork = (config) => evaluate(assignment(wrapup['Plan Wrapup'], 'has_work'), {
    nodes: { 'Load Agent': { voice_config: config } },
  });
  check('mit Feldern', hasWork({ extract: [{ name: 'a', prompt: 'b' }] }) === true);
  check('nur Follow-up', hasWork({ followup: { target: 'email', address: 'a@b.de' } }) === true);
  // Ohne diesen Fall würde ein Agent, der nur den Webhook konfiguriert hat,
  // als "nichts zu tun" übersprungen -- und das Fremdsystem bekäme nie etwas.
  check('nur Webhook', hasWork({ webhook: { url: 'https://kunde.de/x' } }) === true);
  check('leere Konfiguration', hasWork({}) === false);

  group('call-wrapup: Zusammenfassung steht nur an einer Stelle');
  const variables = evaluate(field(wrapup['Store Wrapup'], 'extracted_variables'), { nodes });
  check('summary nicht in extracted_variables', !('summary' in variables), JSON.stringify(variables));
  check('die konfigurierten Felder schon', variables.order_id === 'BX-4471' && variables.anliegen === 'Lieferstatus');
  check('summary in der eigenen Spalte',
    evaluate(field(wrapup['Store Wrapup'], 'summary'), { nodes }) === 'Kunde fragte nach BX-4471.');

  group('call-wrapup: Transkript');
  const text = evaluate(wrapup['Extract From Call'].parameters.text, {
    nodes,
    json: { transcript: [
      { role: 'user', content: 'Wo bleibt meine Bestellung?' },
      { role: 'assistant', content: 'Ich schaue nach.' },
    ] },
  });
  check('Rollen benannt', text === 'Anrufer: Wo bleibt meine Bestellung?\nAgent: Ich schaue nach.', JSON.stringify(text));
}

// ---------------------------------------------------------------------------
// book-appointment: das Ziel kommt nie aus dem Modell
// ---------------------------------------------------------------------------

{
  const booking = nodesOf(load('sub-workflows/book-appointment.json'));
  const slot = (config, requestedStart) => {
    const nodes = {
      'Load Agent Config': { tools: config },
      'Booking Requested': { requested_start: requestedStart, reason: 'Beratung' },
    };
    return {
      calendar: evaluate(assignment(booking['Resolve Slot'], 'calendar_id'), { nodes }),
      duration: evaluate(assignment(booking['Resolve Slot'], 'duration_minutes'), { nodes }),
      start: evaluate(assignment(booking['Resolve Slot'], 'start'), { nodes }),
    };
  };

  group('book_appointment: Kalender aus der Konfiguration');
  const configured = slot(
    [{ slug: 'book_appointment', enabled: true, config: { calendar_id: 'team@kunde.de', duration_minutes: 45 } }],
    '2026-09-22T15:00:00+02:00',
  );
  check('Kalender gelesen', configured.calendar === 'team@kunde.de', String(configured.calendar));
  check('Dauer gelesen', configured.duration === 45, String(configured.duration));
  check('Zeitpunkt gelesen', typeof configured.start === 'string' && configured.start.length > 0);

  const end = evaluate(assignment(booking['Compute End'], 'end'), {
    nodes: { 'Resolve Slot': { start: configured.start, duration_minutes: configured.duration } },
  });
  check('Ende = Beginn + Dauer', (new Date(end) - new Date(configured.start)) / 60000 === 45);

  group('book_appointment: halb oder gar nicht konfiguriert');
  check('kein Kalender hinterlegt',
    slot([{ slug: 'book_appointment', enabled: true, config: {} }], '2026-09-22T15:00:00+02:00').calendar === '');
  check('Dauer fällt auf 30',
    slot([{ slug: 'book_appointment', enabled: true, config: {} }], '2026-09-22T15:00:00+02:00').duration === 30);
  check('Tool gar nicht konfiguriert', slot([], '2026-09-22T15:00:00+02:00').calendar === '');

  group('book_appointment: ein Zeitpunkt wird nicht geraten');
  // Ein erfundener Termin ist schlimmer als eine Rückfrage: der Anrufer legt
  // auf und erscheint zu einer Zeit, die in keinem Kalender steht.
  const config = [{ slug: 'book_appointment', enabled: true, config: { calendar_id: 'a@b.de' } }];
  check('„morgen so gegen drei" bleibt leer', slot(config, 'morgen so gegen drei').start === '');
  check('leerer Wunsch bleibt leer', slot(config, '').start === '');
  check('ISO wird gelesen', slot(config, '2026-09-22T15:00:00+02:00').start !== '');
}

// ---------------------------------------------------------------------------
// kb-crawl: was in die Wissensbasis gerät
// ---------------------------------------------------------------------------

{
  const crawl = nodesOf(load('webhooks/kb-crawl.json'));
  const html = `<!doctype html><html><head><title>Häufige Fragen — Lumen</title>
<style>.x{color:red}</style><script>var tracker=1;</script></head>
<body><nav>Start | Kontakt | Impressum</nav>
<header>Cookie-Banner: Wir nutzen Cookies</header>
<main><h1>W&auml;rmepumpe</h1><p>Der Abschlag wird j&auml;hrlich gepr&uuml;ft.</p>
<p>Gr&#246;&szlig;e: 12 m&#xB2;. Preis 49&nbsp;&euro;.</p>
<p>Bei Fragen &amp; Anliegen rufen Sie an.</p></main>
<footer>© 2026</footer></body></html>`;
  const context = { nodes: { 'Per Page': { url: 'https://kunde.de/faq' } }, json: { data: html } };
  const text = evaluate(assignment(crawl['Extract Text'], 'content'), context);

  group('kb-crawl: aus HTML wird Text');
  check('Inhalt bleibt', text.includes('Der Abschlag wird jährlich geprüft.'), text);
  // Eine unaufgelöste Entity landet sonst als "j&auml;hrlich" in der
  // Wissensbasis, und der Agent liest sie genau so vor.
  check('benannte Entities aufgelöst', text.includes('Wärmepumpe') && text.includes('Größe'));
  check('numerische Entities aufgelöst', text.includes('12 m²'));
  check('Euro und geschütztes Leerzeichen', text.includes('49 €'));
  check('keine Entity übrig', !/&[a-z#]+;/i.test(text), text);
  check('Titel nicht im Fließtext', !text.includes('Häufige Fragen'), text);
  check('Skript, Style, Navigation, Banner weg',
    !/tracker|color:red|Impressum|Wir nutzen Cookies/.test(text), text);
  check('keine Tags übrig', !/<[a-z]/i.test(text));

  group('kb-crawl: Titel');
  const title = (body) => evaluate(assignment(crawl['Extract Text'], 'title'), { ...context, json: { data: body } });
  check('aus <title>, getrimmt', title(html) === 'Häufige Fragen — Lumen', JSON.stringify(title(html)));
  check('fällt auf die URL zurück', title('<html><body>nichts</body></html>') === 'https://kunde.de/faq');

  group('kb-crawl: welche URLs überhaupt geholt werden');
  const urls = (list) => evaluate(assignment(crawl['Normalize Request'], 'urls'), { json: { body: { urls: list } } });
  check('nur http(s)', JSON.stringify(urls(['https://a.de', 'ftp://b.de', 42, null, 'javascript:alert(1)'])) === '["https://a.de"]');
  check('auf 50 gedeckelt', urls(Array.from({ length: 80 }, (_, i) => `https://a.de/${i}`)).length === 50);
}

// ---------------------------------------------------------------------------
// outbound-call: wann angerufen werden darf
// ---------------------------------------------------------------------------

{
  const outbound = nodesOf(load('scheduled/outbound-call.json'));
  const windowExpr = outbound['Within Calling Window?'].parameters.conditions.conditions[0].leftValue;
  const inWindow = (callingWindow, timezone = 'Europe/Berlin') =>
    evaluate(windowExpr, { json: { calling_window: callingWindow, timezone } });

  group('outbound-call: Anrufzeitfenster');
  // Kein Fenster heißt: nicht anrufen. Das ist die sichere Lesart -- ein
  // vergessener Eintrag schweigt, statt zu wählen.
  check('ohne Fenster wird nicht angerufen', inWindow({}) === false);
  check('ohne Fenster auch bei null', inWindow(null) === false);
  const everyDay = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, ['00:00', '23:59']]),
  );
  check('rund um die Uhr an jedem Tag trifft zu', inWindow(everyDay) === true);
  const neverOpen = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, ['03:00', '03:01']]),
  );
  // Eine Minute nachts: praktisch nie, und genau das muss herauskommen.
  check('ein Minutenfenster trifft fast nie zu', inWindow(neverOpen) === false);
}

// ---------------------------------------------------------------------------
// lookup-order: die Spaltenliste ist die Grenze
// ---------------------------------------------------------------------------

{
  const order = nodesOf(load('sub-workflows/lookup-order.json'));
  const sheetSource = {
    id: 's1', label: 'Bestellungen 2026', kind: 'google_sheet', active: true,
    sheet_id: 'abc', sheet_range: 'Bestellungen!A:H', endpoint_url: null,
    match_column: 'Bestellnummer', return_columns: ['Status', 'Lieferung'],
  };
  const pick = (sources, label = '') => runCode(order['Pick Source'], {
    items: sources,
    nodes: { 'Order Requested': { source_label: label } },
  })[0].json;
  const find = (source, payload, ref) => runCode(order['Find Order'], {
    items: payload,
    nodes: { 'Pick Source': source, 'Order Requested': { order_ref: ref } },
  })[0].json;

  group('lookup_order: welche Quelle gemeint ist');
  check('genau eine aktive Quelle wird genommen', pick([sheetSource]).label === 'Bestellungen 2026');
  check('gar keine Quelle ergibt keinen Rateversuch', pick([]).kind === 'none');
  const two = [sheetSource, { ...sheetSource, id: 's2', label: 'Altbestand' }];
  // Die falsche Tabelle vorzulesen ist schlimmer, als zu sagen, dass es
  // gerade nicht geht. Deshalb wird hier nicht die erste genommen.
  check('mehrere ohne Auswahl ergeben keinen Rateversuch', pick(two).kind === 'none');
  check('mehrere mit Auswahl ergeben die benannte', pick(two, 'Altbestand').label === 'Altbestand');
  check('eine Auswahl ohne Treffer ergibt keinen Rateversuch', pick(two, 'Gibt es nicht').kind === 'none');

  const grid = [
    ['Bestellnummer', 'Status', 'Lieferung', 'Einkaufspreis', 'Interne Notiz'],
    ['A-1234', 'versandt', '22.09.', '12,40', 'Kunde meckert immer'],
    ['A-1235', 'offen', '-', '3,10', ''],
  ];

  group('lookup_order: nur freigegebene Spalten verlassen den Workflow');
  const hit = find(pick([sheetSource]), [{ values: grid }], 'A-1234');
  check('Bestellung gefunden', hit.found === true);
  check('der Status kommt mit', hit.order.Status === 'versandt');
  check('der Einkaufspreis bleibt in der Tabelle', !('Einkaufspreis' in hit.order));
  check('die interne Notiz bleibt in der Tabelle', !('Interne Notiz' in hit.order));
  check('die Bestellnummer selbst auch', !('Bestellnummer' in hit.order));
  // Der Satz an das Modell ist die zweite Stelle, an der etwas entweichen
  // könnte -- eine saubere Projektion nützt nichts, wenn daneben die ganze
  // Zeile im Klartext steht.
  check('auch der Satz an das Modell trägt nur das Freigegebene',
    !hit.result.includes('12,40') && !hit.result.includes('meckert'));

  group('lookup_order: was passiert, wenn nichts passt');
  check('eine unbekannte Nummer', find(pick([sheetSource]), [{ values: grid }], 'Z-9').found === false);
  check('Groß-, Kleinschreibung und Leerzeichen sind egal',
    find(pick([sheetSource]), [{ values: grid }], '  a-1234 ').found === true);

  group('lookup_order: Konfigurationsfehler werden protokolliert, nicht verschwiegen');
  check('keine nutzbare Quelle wird als Fehler geloggt', find(pick([]), [{ values: [] }], 'A-1234').status === 'error');
  const typo = { ...sheetSource, return_columns: ['Statuss'] };
  const nothingReleased = find(pick([typo]), [{ values: grid }], 'A-1234');
  check('ein Tippfehler in der Spaltenliste auch', nothingReleased.status === 'error');
  check('und wird nicht als „nicht gefunden" getarnt', nothingReleased.found === true);

  group('lookup_order: der eigene Endpunkt');
  const httpSource = { ...sheetSource, kind: 'http', endpoint_url: 'https://api.example.com/orders' };
  const shapes = {
    'ein einzelnes Objekt': [{ Bestellnummer: 'A-1234', Status: 'versandt', Marge: '4,20' }],
    'eine Liste': [{ Bestellnummer: 'A-9' }, { Bestellnummer: 'A-1234', Status: 'versandt' }],
    'orders darin': [{ orders: [{ Bestellnummer: 'A-1234', Status: 'versandt' }] }],
    'data darin': [{ data: [{ Bestellnummer: 'A-1234', Status: 'versandt' }] }],
    'results darin': [{ results: [{ Bestellnummer: 'A-1234', Status: 'versandt' }] }],
  };
  for (const [label, payload] of Object.entries(shapes)) {
    const found = find(pick([httpSource]), payload, 'A-1234');
    check(label, found.found === true && found.order.Status === 'versandt');
  }
  check('die Marge bleibt beim Kunden',
    !('Marge' in find(pick([httpSource]), shapes['ein einzelnes Objekt'], 'A-1234').order));
}

// ---------------------------------------------------------------------------
// voicemail-transcribe: eine leere Abschrift ist keine
// ---------------------------------------------------------------------------

{
  const voicemail = nodesOf(load('webhooks/voicemail-transcribe.json'));
  const shape = (payload, url = 'https://api.twilio.test/RE1') => runCode(voicemail['Shape Transcript'], {
    items: [payload],
    nodes: { 'Normalize Request': { recording_url: url } },
  })[0].json;

  group('voicemail: woher der Text kommt');
  // Die Form der Antwort hängt an Node-Version und `simplify`. Statt eine davon
  // zu raten, muss jede bekannte Stelle gelesen werden.
  check('aus `text`', shape({ text: 'Hier ist Frau Berger.' }).transcript === 'Hier ist Frau Berger.');
  check('aus `content`', shape({ content: 'Hier ist Frau Berger.' }).transcript === 'Hier ist Frau Berger.');
  check('aus der rohen Gemini-Antwort',
    shape({ candidates: [{ content: { parts: [{ text: 'Hier ist Frau Berger.' }] } }] }).transcript
      === 'Hier ist Frau Berger.');

  group('voicemail: was nicht als Abschrift durchgeht');
  // Der leere String ist in `calls.voicemail_transcript` verboten; käme er hier
  // durch, scheiterte erst die Datenbank -- und die Abschrift wäre verloren,
  // obwohl die Aufnahme noch da ist.
  check('gar keine Antwort', shape({}).ok === false);
  check('nur Leerzeichen', shape({ text: '   ' }).ok === false);
  check('nichts davon landet in der Spalte', shape({ text: '  ' }).transcript === null);

  // Die Gegenprobe zu einer Versuchung, die hier zuerst im Code stand: eine
  // Erkennung von Absagen des Modells ("Es tut mir leid, ich konnte nichts
  // verstehen"). Jedes Muster dafür trifft auch echte Nachrichten -- und
  // ausgerechnet die dringendste fängt oft so an.
  check('„Leider" ist ein ganz normaler Anfang',
    shape({ text: 'Leider muss ich den Termin morgen absagen.' }).ok === true);
  check('und die Nachricht bleibt vollständig',
    shape({ text: 'Leider muss ich den Termin morgen absagen.' }).transcript
      === 'Leider muss ich den Termin morgen absagen.');

  group('voicemail: der Ticket-Text sagt in beiden Fällen die Wahrheit');
  const good = shape({ text: 'Bitte rufen Sie zurueck.' });
  check('mit Abschrift steht sie im Ticket', good.description.includes('Bitte rufen Sie zurueck.'));
  check('und die Aufnahme bleibt verlinkt', good.description.includes('https://api.twilio.test/RE1'));
  const bad = shape({});
  // Ohne diesen Satz sähe ein Fehlschlag genauso aus wie eine Nachricht, die
  // niemand hinterlassen hat.
  check('ohne Abschrift steht der Hinweis darin', bad.description.includes('bitte anhoeren'));
  check('und die Aufnahme erst recht', bad.description.includes('https://api.twilio.test/RE1'));

  group('voicemail: die Obergrenze der Spalte wird eingehalten');
  const long = shape({ text: 'a'.repeat(25000) });
  check('abgeschnitten statt abgewiesen', long.ok === true && long.chars === 20000, String(long.chars));
}

console.log(`\n${checks} Prüfungen, ${failures} Fehler`);
process.exit(failures === 0 ? 0 : 1);
