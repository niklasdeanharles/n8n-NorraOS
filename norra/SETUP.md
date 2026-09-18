# Inbetriebnahme

Was nur ein Mensch tun kann. Der Code steht; was fehlt, sind Konten, Secrets
und die Verbindung dazwischen — nichts davon darf im Repository liegen, und
genau deshalb steht hier eine Anleitung und kein Skript.

> **Die Reihenfolge ist nicht beliebig.** Jeder Schritt liefert etwas, das der
> nächste braucht: aus Supabase kommen die Schlüssel für Vercel *und* für n8n,
> und ohne ausgerolltes Schema hat n8n nichts, worauf es schreiben könnte.

Am Ende steht eine Probe, die ohne Raten sagt, ob es reicht:
`node scripts/preflight.mjs` und der Screen **Betrieb** in der Konsole.

> **Voraussetzung für alles mit einem Knopf:** die vier `norra-*`-Workflows
> müssen auf `master` liegen. GitHub liest `workflow_dispatch` und `schedule`
> ausschließlich aus dem Standard-Branch — solange sie nur im Feature-Branch
> stehen, tauchen sie unter *Actions* gar nicht erst auf, und ein Auslösen
> antwortet mit 404. Sie kommen mit dem Merge von PR #1 dorthin. Bis dahin
> laufen sie nur als PR-Prüfung mit, und die Schritte 3 und 6 unten gehen von
> Hand statt per Knopf.

---

## Wie weit willst du?

Nicht alles ist für alles nötig. Die Stufen bauen aufeinander auf; du kannst
nach jeder aufhören und hast etwas Laufendes.

| Stufe | Was dann geht | Was du dafür brauchst |
|---|---|---|
| **A — Konsole** | Anmelden, Agenten anlegen, Wissensbasis pflegen | Supabase, ein Hosting (Schritt 7) |
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

> **Dieser Schritt ist Bequemlichkeit, keine Voraussetzung.** Die fünf Secrets
> automatisieren genau zwei Dinge: den Schema-Rollout (Schritt 3) und das
> Ausrollen der Workflows (Schritt 6). Beides geht von Hand, und die Stufen A
> bis D hängen an keinem davon. Wer hier hängenbleibt, überspringt den Schritt
> und macht weiter — Norra läuft trotzdem.

### Wenn die Secrets leer ankommen

Gemessen auf `master`, Lauf `e3de87ec`: **alle fünf** kamen mit null Zeichen an,
`supabase link --project-ref ""` eingeschlossen. Nicht vier von fünf, nicht die
zwei n8n-Werte — alle. Ein einzelner vergessener Eintrag sieht anders aus.

Zwei Ursachen erklären das, und beide sehen in der Oberfläche identisch aus:

1. **Der falsche Reiter.** In der linken Spalte unter *Secrets and variables*
   stehen drei Einträge untereinander: **Actions**, **Codespaces**,
   **Dependabot**. Jeder hat eine eigene Liste mit der Überschrift
   *Repository secrets*, und ein Secret im falschen davon ist für Actions
   schlicht nicht vorhanden. Die Adresszeile ist der Beweis: sie muss auf
   `/settings/secrets/actions` enden.
2. **Das falsche Repository.** Derselbe Screenshot entsteht in jedem Repository.
   Vor dem Namen muss `niklasdeanharles/n8n-NorraOS` stehen.

`norra-secrets-check.yml` beantwortet das ohne Raten: der Lauf listet die
*Namen* der Secrets, die tatsächlich ankommen — `toJSON(secrets)`, dessen Werte
GitHub ohnehin maskiert. Liegt dort nur `github_token`, ist keines der fünf im
Actions-Reiter dieses Repositories.

## 3 · Schema ausrollen

Sobald `norra-db-migrate.yml` auf `master` liegt, löst ein Push, der
`backend/supabase/` berührt, den Rollout aus: der Workflow spielt die Migrationen erst gegen ein
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

## 7 · Hosting

Die App ist eine gewöhnliche Next.js-Anwendung mit Node-Laufzeit — kein
Edge-Runtime, kein Vercel-SDK, keine Vercel-spezifische Konfiguration. Sie
läuft überall, wo ein Node-Prozess laufen darf. Zwei Wege, und der erste ist
der, den du schon bezahlst.

### 7a · Der eigene VPS (empfohlen)

Auf dem Hostinger-Rechner, auf dem n8n schon steht. Vollständige Anleitung in
[`deploy/README.md`](deploy/README.md); kurz:

```bash
git clone https://github.com/niklasdeanharles/n8n-NorraOS.git
cd n8n-NorraOS/norra/deploy
cp norra.env.example norra.env && $EDITOR norra.env
docker compose up -d --build
```

Danach im Reverse Proxy, der dort schon TLS für n8n macht, einen Block auf
`127.0.0.1:3000` — Beispiele für Caddy und nginx liegen daneben.

Drei Gründe, die schwerer wiegen als der Preis:

- **Kein Zeitlimit pro Aufruf.** Der Telefonpfad gibt sich selbst zwölf
  Sekunden. Gegen ein hartes Funktionslimit ist das eine Rechnung, die knapp
  aufgeht; hier ist es keine.
- **n8n liegt nebenan.** Jeder Turn geht sonst übers öffentliche Netz samt
  TLS-Handshake. Im selben Docker-Netzwerk wird daraus `http://n8n:5678`.
- **Vercels Hobby-Tarif ist nicht für kommerzielle Projekte.** Norra soll
  Kunden haben. Gratis wäre dort nur der Anfang.

Der Build braucht ~1,5 GB Arbeitsspeicher. Auf einem kleinen VPS neben n8n ist
das knapp — vorher 2 GB Swap anlegen, siehe `deploy/README.md`.

### 7b · Vercel

Repository verbinden, **Root Directory** auf `norra/frontend` setzen. Dann
unter **Settings → Environment Variables** eintragen, was in
`frontend/.env.example` steht:

```
NEXT_PUBLIC_SUPABASE_URL       aus Schritt 1
NEXT_PUBLIC_SUPABASE_ANON_KEY  aus Schritt 1
SUPABASE_SERVICE_ROLE_KEY      aus Schritt 1
N8N_WEBHOOK_URL                die URL deiner n8n-Instanz
N8N_WEBHOOK_SECRET             derselbe String wie in Schritt 5
NORRA_PUBLIC_URL               die Vercel-URL dieser App
```

### Beides

Für den Screen *Betrieb* zusätzlich `N8N_BASE_URL`, `N8N_API_KEY` und
`NORRA_OPS_ORG_ID` — **alle drei**, sonst bleibt die Karte „Die Instanz"
geschlossen. Das ist Absicht: die n8n-Instanz gehört allen Mandanten gemeinsam,
und ein API-Key allein wäre die Abkürzung, die diese Grenze aufhebt.

`NEXT_PUBLIC_*` wird beim **Bauen** eingesetzt. Wer sie nachträglich ändert,
muss neu deployen bzw. neu bauen — die alte App redet sonst weiter mit dem
alten Projekt.

### Andere Gratis-Anbieter

| Anbieter | Taugt? |
|---|---|
| **Netlify** | ja, Next-Laufzeit und Streaming funktionieren; 125k Aufrufe/Monat gratis |
| **Cloudflare Workers** | im Prinzip ja über OpenNext, aber `node:crypto` und Middleware wollen Handarbeit |
| **Render (Free)** | **nein für Stufe C.** Der Dienst schläft nach 15 Minuten ein und braucht ~50 s zum Aufwachen — Twilio legt vorher auf |
| **Fly.io** | kein echtes Gratis-Kontingent mehr |

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
| GitHub-Action meldet ein leeres Secret | Secret liegt im Reiter *Codespaces* oder *Dependabot* statt *Actions* |
| Sprachnachricht ohne Abschrift | `googlePalmApi` oder `twilioApi` fehlt an `voicemail-transcribe` |

Der Reflex bei allem, was nach Verdrahtung riecht:

```bash
cd backend && node scripts/check-wiring.mjs
```
