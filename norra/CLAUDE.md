# Norra OS

AI-gestützte Customer-Support-Plattform. Dieses Verzeichnis ist die Wurzel des
Norra-OS-Projekts und **unabhängig vom umgebenden n8n-Monorepo**.

> Das umgebende Repository ist ein Fork des n8n-Monorepos. `norra/` ist bewusst
> **nicht** in der Wurzel-`pnpm-workspace.yaml` eingetragen: n8n's Turbo-Build
> und CI fassen diesen Code nie an, und der Fork bleibt upstream-mergefähig.
> Deshalb hat `norra/app` eine eigene `package.json` und ein eigenes Lockfile.

## Leitprinzip

Alles, was Logik enthält, lebt entweder als Code in Git oder als Workflow-JSON
in Git. Es gibt keinen Zustand, der nur durch Klicken in einer UI entstanden ist.

## Architektur

```mermaid
flowchart LR
  B[Browser] -->|POST /api/agent-turn| N[Next.js on Vercel]
  N -->|Header-Auth Webhook, SSE| W[n8n: agent-turn]
  N -->|CRUD, RLS als User| S[(Supabase)]
  W -->|service_role| S
  W --> C[Claude API]
  W --> V[Supabase Vector Store]
  W --> T[Tools / Sub-Workflows]
  S -->|Realtime| B
```

**Next.js ist dünn.** Es macht Auth, UI/Dashboard, direkte Supabase-Reads und
genau einen Proxy (`/api/agent-turn`), der die User-Message persistiert, den
n8n-Webhook aufruft und den gestreamten Body 1:1 durchreicht. Es enthält
**keine** Claude-Integration und **keine** Vektor-Suche.

**n8n ist die Intelligenz.** Zentraler Workflow `agent-turn`: Webhook
(`responseMode: streaming`, Header-Auth) → AI Agent Node (Streaming) →
Supabase Vector Store als Retrieval-Tool → Custom Tools und Sub-Agenten via
Execute-Workflow-Node.

**Supabase ist die einzige Integrationsfläche.** n8n schreibt Ergebnisse per
Supabase-Node zurück; Realtime pusht sie an Chat-UI und Handoff-Dashboard.
Next.js und n8n sprechen nie direkt miteinander außer über den einen Webhook.

## Ordnerstruktur

| Pfad | Inhalt |
|---|---|
| `norra/app/` | Next.js App Router (Vercel Root Directory) |
| `norra/supabase/migrations/` | SQL-Migrationen, per GitHub Action ausgerollt |
| `norra/n8n-workflows/` | Exportierte Workflow-JSONs (Sync via REST-API) |
| `norra/scripts/` | Sync-/Wartungsskripte |
| `norra/docs/` | Architektur- und Betriebsnotizen |

## Namenskonventionen

- **Datenbank:** `snake_case`, Tabellen im Plural, Enums als Postgres-Typen im
  Singular (`user_role`, `conversation_status`). Jede fachliche Tabelle trägt
  `organization_id` — auch wo es redundant wirkt.
- **Migrationen:** `<utc-timestamp>_<beschreibung>.sql`, aufsteigend, niemals
  rückwirkend editieren. Eine Migration = eine logische Einheit.
- **TypeScript:** `camelCase` für Variablen, `PascalCase` für Typen. Kein `any`.
  DB-Zeilen kommen aus `Database` in `src/types/database.ts`.
- **n8n-Workflows:** Dateiname = `<slug>.json`, Slug = Workflow-Name in
  kebab-case (`agent-turn.json`).

## Multi-Tenant-Regeln

Diese vier Regeln sind nicht verhandelbar:

1. **Jede fachliche Tabelle hat `organization_id`** mit
   `references organizations(id) on delete cascade`. Denormalisiert statt
   Join — RLS ohne Subquery ist schneller und schwerer falsch zu schreiben.
2. **RLS ist auf jeder Tabelle aktiv.** Policies vergleichen gegen
   `private.current_org_id()`, eine `security definer`-Funktion mit gepinntem
   `search_path`, die `public.users` für `auth.uid()` liest. `security definer`
   umgeht RLS und vermeidet damit die Endlosrekursion in der Policy auf `users`.
3. **n8n verbindet sich mit `service_role` und umgeht RLS damit vollständig.**
   Im n8n-Pfad ist RLS *keine* Verteidigungslinie. Mandantentrennung dort hängt
   allein daran, dass `public.match_kb_chunks` die `organization_id`
   serverseitig erzwingt und ohne sie hart fehlschlägt. Jede neue RPC, die n8n
   aufruft, muss dieselbe Erzwingung mitbringen.
4. **Ein User gehört zu genau einer Organisation** (`users.organization_id`).
   Multi-Org wäre später eine `organization_members`-Tabelle; bis dahin gilt
   die Spalte.

## Rollen

`user_role` = `admin` | `agent` | `customer`.

- `admin` — verwaltet Agenten, Wissensbasis und Mitglieder der eigenen Org.
- `agent` — menschlicher Support-Mitarbeiter, übernimmt Konversationen.
- `customer` — **reserviert** für ein späteres authentifiziertes Kundenportal.
  Endkunden im Chat-Widget sind heute *keine* Supabase-Auth-User; der
  Widget-Pfad läuft über den Next.js-Proxy mit signiertem Conversation-Token.

## Environment

| Variable | Wo | Zweck |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel, lokal | Supabase-Projekt-URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel, lokal | Client-/SSR-Key, RLS greift |
| `SUPABASE_SERVICE_ROLE_KEY` | nur Server | umgeht RLS — niemals an den Client |
| `N8N_WEBHOOK_URL` | Vercel | Basis-URL der n8n-Instanz |
| `N8N_WEBHOOK_SECRET` | Vercel + n8n | Header-Auth zwischen Proxy und Webhook |

Secrets stehen niemals im Repo. `.env.local` ist gitignored;
`norra/app/.env.example` dokumentiert nur die Namen.

## n8n-Instanz

- URL: _noch einzutragen_ (Hostinger VPS, self-hosted Community Edition)
- Workflow-IDs: werden hier eingetragen, sobald die Workflows angelegt sind.

| Workflow | Slug | ID | Zweck |
|---|---|---|---|
| Agent Turn | `agent-turn` | _tbd_ | Zentraler Turn: RAG, Tools, Streaming |
| KB Ingest | `kb-ingest` | _tbd_ | Dokumente chunken, einbetten, speichern |

## Befehle

```bash
cd norra/app && npm install     # Abhängigkeiten (eigenes Lockfile!)
npm run dev                     # Dev-Server
npm run typecheck               # tsc --noEmit, muss vor jedem Commit grün sein
npm run lint

cd norra && supabase db push    # Migrationen ausrollen (macht sonst die Action)
supabase gen types typescript --linked > app/src/types/database.ts
```

Migrationen und Mandantentrennung gegen ein blankes Postgres pruefen -- genau
das, was `norra-db-migrate.yml` in CI tut:

```bash
cd norra/supabase
psql -v ON_ERROR_STOP=1 -f tests/bootstrap.local.sql
for f in migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -v ON_ERROR_STOP=1 -f tests/tenancy.test.sql   # muss "all checks passed" melden
```
