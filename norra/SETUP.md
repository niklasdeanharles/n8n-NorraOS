# Inbetriebnahme

Was nur ein Mensch tun kann. Der Code steht; was fehlt, sind Konten, Secrets
und die Verbindung dazwischen — nichts davon darf im Repository liegen, und
genau deshalb steht hier eine Anleitung und kein Skript.

> **Die Reihenfolge ist nicht beliebig.** Jeder Schritt liefert etwas, das der
> nächste braucht: aus Supabase kommen die Schlüssel für Vercel *und* für n8n,
> und ohne ausgerolltes Schema hat n8n nichts, worauf es schreiben könnte.

Am Ende steht eine Probe, die ohne Raten sagt, ob es reicht:
`node scripts/preflight.mjs` und der Screen **Betrieb** in der Konsole.

---

## Wie weit willst du?

Nicht alles ist für alles nötig. Die Stufen bauen aufeinander auf; du kannst
nach jeder aufhören und hast etwas Laufendes.

| Stufe | Was dann geht | Was du dafür brauchst |
|---|---|---|
| **A — Konsole** | Anmelden, Agenten anlegen, Wissensbasis pflegen | Supabase, Vercel |
| **B — Chat** | Das Web-Widget auf einer echten Seite | dazu n8n mit `supabaseApi`, `openAiApi`, `anthropicApi`, `httpHeaderAuth` |
| **C — Telefon** | Eingehende Anrufe, Durchstellen, Anrufbeantworter | dazu Twilio |
| **D — Der ganze Empfang** | Termine, Mails, Bestellungen, Abschriften | dazu Google Calendar, Gmail, Google Sheets, Google AI Studio |

---

## 1 · Supabase

Projekt anlegen auf [supabase.com](https://supabase.com). Danach unter
**Settings → API** drei Werte notieren:

| Wert | Wofür |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` public key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` — **nie** in den Browser |

Dazu aus **Settings → General** die Project-ID (Reference ID) und das
Datenbank-Passwort, das du beim Anlegen vergeben hast.

> Der `service_role`-Key umgeht Row Level Security vollständig. Er gehört in
> Vercels Server-Umgebung und in n8n, sonst nirgendwohin — und niemals in eine
> Variable mit `NEXT_PUBLIC_`-Präfix, denn die wird beim Bauen in das
> JavaScript geschrieben, das jeder Besucher lädt.

## 2 · GitHub-Secrets

Repository → **Settings → Secrets and variables → Actions → New secret**:

| Secret | Woher | Wofür |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens | Migrationen ausrollen |
| `SUPABASE_PROJECT_ID` | Schritt 1 | Migrationen ausrollen |
| `SUPABASE_DB_PASSWORD` | Schritt 1 | Migrationen ausrollen |
| `N8N_BASE_URL` | die URL deiner n8n-Instanz | Workflows ausrollen und sichern |
| `N8N_API_KEY` | n8n → Settings → API | Workflows ausrollen und sichern |

## 3 · Schema ausrollen

Ein Push auf `master`, der `backend/supabase/` berührt, löst
`norra-db-migrate.yml` aus: der Workflow spielt die Migrationen erst gegen ein
Wegwerf-Postgres und rollt sie dann aus. Von Hand geht es auch:

```bash
cd backend/supabase && supabase db push
```

Danach steht das Schema — 26 Tabellen, RLS auf allen, pgvector für die
Wissensbasis.

## 4 · n8n: die Umgebungsvariable

Auf der n8n-Instanz (bei Hostinger in der Container-Konfiguration):

```
NORRA_PUBLIC_URL=https://deine-app.vercel.app
```

Nur `outbound-call` liest sie — ohne sie rufen Kampagnen ins Leere, alles
andere läuft.

## 5 · n8n: Credentials

Zehn Stück, aber nicht alle auf einmal. Die Spalte *Stufe* sagt, ab wann sie
gebraucht werden; die Liste ist aus den Workflow-Dateien abgeleitet, nicht
abgeschrieben.

| Credential | Typ in n8n | Stufe | Wird gebraucht von |
|---|---|---|---|
| Supabase | `supabaseApi` | B | 19 Workflows — praktisch alles |
| OpenAI | `openAiApi` | B | `agent-turn`, `kb-ingest`, `voice-turn` (nur die Einbettungen) |
| Anthropic | `anthropicApi` | B | `agent-turn`, `voice-turn`, `call-wrapup` |
| Norra Webhook Secret | `httpHeaderAuth` | B | die sechs Webhook-Nodes |
| Twilio | `twilioApi` | C | `send-sms`, `outbound-call`, `voicemail-transcribe` |
| Google Calendar | OAuth2 **oder** Service-Account | D | `book-appointment` |
| Gmail | OAuth2 **oder** Service-Account | D | `notify-escalation`, `call-wrapup`, `take-message` |
| Google Sheets | `googleSheetsOAuth2Api` | D | `lookup-order`, nur bei einer Bestellquelle vom Typ Sheet |
| Google AI Studio | `googlePalmApi` | D | `voicemail-transcribe` — der Gemini-Key; n8n nennt die Credential noch nach PaLM |
| Kunden-Endpunkt | `httpHeaderAuth`, eigene | D | `lookup-record`, `lookup-order`, nur bei einem eigenen Endpunkt |

Beim Supabase-Credential trägst du die Project-URL und den **`service_role`**-Key
ein — n8n arbeitet mandantenübergreifend und umgeht RLS; die Trennung machen
die `organization_id`-Filter in den Nodes.

Das Webhook-Secret braucht den Header-Namen **`x-norra-secret`** und als Wert
denselben zufälligen String, den du gleich als `N8N_WEBHOOK_SECRET` in Vercel
einträgst. Weichen sie voneinander ab, weist der Webhook die App ab — und zwar
stillschweigend mit 403.

> **Anlegen reicht nicht.** Eine Credential, die an keinem Node hängt, steht in
> der Liste und sieht aus wie erledigt. In n8n musst du sie in jedem Node
> einmal auswählen. `preflight.mjs` prüft deshalb nicht, ob es sie *gibt*,
> sondern ob sie *hängt*.

## 6 · n8n: Workflows anlegen und aktivieren

Sieben der neunzehn Workflows liegen schon auf der Instanz und tragen ihre ID
im Repository. **Zwölf nicht.** Der normale Deploy legt sie absichtlich nicht
an — einer, der das bei jedem Push täte, legt sie irgendwann doppelt an. Einmal
auf Knopfdruck:

> GitHub → **Actions** → *Norra: n8n Deploy* → **Run workflow** →
> Häkchen bei **create_missing** → **Run workflow**

Der Lauf legt die zwölf an, schreibt die neuen IDs in die JSON-Dateien und
committet sie zurück nach `master`. Der letzte Teil ist der wichtige: die
Zuordnung Datei → Instanz steht ausschließlich in `norra.workflowId`, und ohne
sie legt der nächste Lauf dieselben Workflows ein zweites Mal an.

Dein API-Key bleibt dabei im GitHub-Secret — du tippst ihn nirgends in eine
Kommandozeile. Am eigenen Rechner ginge es auch:

```bash
cd backend && node scripts/n8n-sync.mjs deploy --create-missing
```

Ab dann genügt ein Push auf `master` — `norra-n8n-deploy.yml` schiebt jede
Änderung nach.

**Aktivieren musst du selbst.** Der Deploy fasst das Feld `active` absichtlich
nicht an: ein Rollout, der nebenbei Webhooks scharf schaltet, ist ein Rollout,
der nachts niemanden fragt. Scharf gehören die sechs Webhook-Workflows und
`outbound-call`; die Sub-Workflows werden gerufen und brauchen es nicht.

## 7 · Vercel

Repository verbinden, **Root Directory** auf `norra/frontend` setzen. Dann unter
**Settings → Environment Variables** eintragen, was in
`frontend/.env.example` steht:

```
NEXT_PUBLIC_SUPABASE_URL       aus Schritt 1
NEXT_PUBLIC_SUPABASE_ANON_KEY  aus Schritt 1
SUPABASE_SERVICE_ROLE_KEY      aus Schritt 1
N8N_WEBHOOK_URL                die URL deiner n8n-Instanz
N8N_WEBHOOK_SECRET             derselbe String wie in Schritt 5
NORRA_PUBLIC_URL               die Vercel-URL dieser App
```

Für den Screen *Betrieb* zusätzlich `N8N_BASE_URL`, `N8N_API_KEY` und
`NORRA_OPS_ORG_ID` — **alle drei**, sonst bleibt die Karte „Die Instanz"
geschlossen. Das ist Absicht: die n8n-Instanz gehört allen Mandanten gemeinsam,
und ein API-Key allein wäre die Abkürzung, die diese Grenze aufhebt.

`NEXT_PUBLIC_*` wird beim **Bauen** eingesetzt. Wer sie nachträglich ändert,
muss neu deployen — die alte App redet sonst weiter mit dem alten Projekt.

## 8 · Twilio (Stufe C)

Nummer kaufen, dann in deren Konfiguration zwei URLs eintragen:

| Feld | Wert |
|---|---|
| A call comes in → Webhook | `https://deine-app.vercel.app/api/voice/incoming` |
| Call status changes | `https://deine-app.vercel.app/api/voice/status` |

Den Auth-Token aus **Account Info** als `TWILIO_AUTH_TOKEN` nach Vercel. Die
Signaturprüfung hasht die **vollständige** URL — `NORRA_PUBLIC_URL` muss also
exakt dem entsprechen, was bei Twilio steht, Schema inklusive.

In der Konsole dann unter *Telefon* die Nummer anlegen und einem Agenten
zuweisen. Alles Weitere — Begrüßung, Stimme, Öffnungszeiten, Weiterleitung —
ist ein Formular, kein Ticket.

## 9 · Probe

```bash
cd backend
N8N_BASE_URL=... N8N_API_KEY=... node scripts/preflight.mjs
```

Das Skript sagt, welcher Workflow fehlt, welcher inaktiv ist und an welchem
Node eine Credential fehlt — Node für Node, nicht nur „irgendwas stimmt nicht".

Dasselbe im Browser: der Screen **Betrieb** in der Konsole. Er zeigt beide
Hälften — die eigenen Leitungen und gescheiterten Anrufe für jeden Admin, den
Zustand der Instanz nur für den Betreiber.

Zum Schluss die ehrlichste Probe: einen Agenten anlegen, Kanal *Web*
aktivieren, den Einbettungs-Code auf eine Seite legen und selbst schreiben.

---

## Wenn etwas nicht geht

| Symptom | Ursache, fast immer |
|---|---|
| Widget antwortet nicht, Konsole zeigt 403 | `N8N_WEBHOOK_SECRET` ≠ der Wert in der `httpHeaderAuth`-Credential |
| Webhook antwortet mit 404 | Workflow liegt auf der Instanz, ist aber nicht aktiviert (Schritt 6) |
| Anruf bricht sofort ab | `NORRA_PUBLIC_URL` weicht von der bei Twilio eingetragenen URL ab |
| Agent antwortet, aber die Auswertung bleibt leer | `anthropicApi` hängt nicht am Klassifikations-Node |
| Wissensbasis findet nichts | `openAiApi` fehlt — ohne Einbettungen keine Vektorsuche |
| Sprachnachricht ohne Abschrift | `googlePalmApi` oder `twilioApi` fehlt an `voicemail-transcribe` |

Der Reflex bei allem, was nach Verdrahtung riecht:

```bash
cd backend && node scripts/check-wiring.mjs
```
