# Norra – Frontend

Die Next.js-App der Norra-Plattform: Betreiber-Konsole, einbettbares
Web-Widget und die Webhook-Routen für Telefonie. Schema und Agentenlogik
liegen im Repository `norra-backend`.

## Was hier drin ist

| Ordner | Inhalt |
|---|---|
| `src/app/(admin)/` | Acht Screens: Dashboard, Chat, Analytics, Agenten, Telefon, Wissen, Governance, Team, Einstellungen |
| `src/app/widget/` | Das öffentliche Chat-Widget (läuft im Iframe auf Kundenseiten) |
| `src/app/api/` | Proxy nach n8n, Twilio-Webhooks, Widget-API, CSAT |
| `src/lib/` | Supabase-Clients, Env-Validierung, Voice- und Widget-Hilfen |
| `tests/` | Vier End-to-End-Suiten gegen die gebaute App |

## Schnellstart

```bash
npm install
cp .env.example .env.local     # Werte eintragen
npm run dev
```

Ohne Supabase-Projekt startet die App nicht — `src/lib/env.ts` prüft die
Variablen beim Laden und sagt, welche fehlt. Telefonie (`TWILIO_AUTH_TOKEN`,
`NORRA_PUBLIC_URL`) ist optional; ohne sie läuft alles außer eingehenden
Anrufen.

## Prüfen

```bash
npm run typecheck
npm run lint
node tests/voice/run.mjs     # 16 Szenarien: Anruf → Turn → Weiterleitung → Status
node tests/widget/run.mjs    # 13 Szenarien: Session → Turn → Token-Angriffe → Bewertung
node tests/simulate/run.mjs  # 12 Szenarien: Testfälle als angemeldeter Admin
node tests/console/run.mjs   # 17 Szenarien: Agent-Turn und Wissens-Ingest
```

Alle vier Suiten bauen die App selbst und fahren sie gegen In-Memory-Stand-ins
für PostgREST und n8n hoch. Sie haben in dieser Form schon Fehler gefunden,
die kein Typecheck sieht — eine Middleware, die jeden Anruf auf die
Login-Seite geschickt hätte, zum Beispiel.

## Zwei Repositories, eine Plattform

Beide Anordnungen funktionieren, die Drift-Prüfung des Backends findet diese
App in jeder von selbst:

```
norra/                        norra/
├── norra-backend/            ├── backend/
└── norra-frontend/  ← hier   └── frontend/   ← hier
```

```bash
node ../norra-backend/scripts/check-wiring.mjs   # bzw. ../backend/scripts/…
```

Sie vergleicht Webhook-Pfade, Payload-Felder und jeden Spaltennamen, den eine
API-Route nennt, gegen das echte Schema. In CI läuft das automatisch, sobald
die Repository-Variable `NORRA_BACKEND_REPO` gesetzt ist.

## Deployment

Vercel, Root Directory = Repo-Wurzel. Die Umgebungsvariablen stehen in
[CLAUDE.md](CLAUDE.md#environment).

## Weiterlesen

[CLAUDE.md](CLAUDE.md) erklärt die Entscheidungen: warum das Widget-Token die
gesamte Vertrauensgrenze trägt, warum der Telefon-Workflow nicht streamt,
warum Einstellungen echte Spalten bekommen statt eines jsonb-Blobs.
