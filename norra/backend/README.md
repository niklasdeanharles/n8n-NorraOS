# Norra – Backend

Supabase-Schema und n8n-Workflows der Norra-Plattform. Hier liegt, was ein
Agent *weiß* und *entscheidet*; die Oberfläche liegt im Repository
`norra-frontend`.

## Was hier drin ist

| Ordner | Inhalt |
|---|---|
| `supabase/migrations/` | 13 Migrationen: Schema, RLS, Vektor-Suche, Telefonie |
| `supabase/tests/` | Drei ausführbare Testsuiten für Mandantentrennung, Governance und Telefonie |
| `n8n-workflows/` | 7 Workflow-JSONs — der Agenten-Turn, die Tools, die Benachrichtigung |
| `scripts/` | `n8n-sync.mjs` (Git ↔ n8n) und `check-wiring.mjs` (Drift-Prüfung) |
| `docs/` | Betriebsnotizen |

## Schnellstart

```bash
# Schema gegen ein leeres Postgres prüfen
cd supabase
psql -v ON_ERROR_STOP=1 -f tests/bootstrap.local.sql
for f in migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -f "$f"; done
for t in tenancy governance phone; do psql -v ON_ERROR_STOP=1 -f "tests/$t.test.sql"; done
```

```bash
# Workflows und Schema auf Drift prüfen
node scripts/check-wiring.mjs
```

## Zwei Repositories, eine Plattform

Beide Anordnungen funktionieren, `check-wiring.mjs` findet die App in jeder
von selbst:

```
norra/                        norra/
├── norra-backend/   ← hier   ├── backend/    ← hier
└── norra-frontend/           └── frontend/
```

Nur dann läuft auch die Hälfte der Prüfung, die über die Repo-Grenze geht
(Webhook-Pfade, Payload-Felder, Spaltennamen in den API-Routen). Liegt die App
woanders: `NORRA_APP_DIR=/pfad/zur/app`.

## Deployment

Drei GitHub Actions, alle in `.github/workflows/`:

| Workflow | Auslöser | Wirkung |
|---|---|---|
| `db-migrate.yml` | Push auf `main` unter `supabase/**` | prüft gegen ein Wegwerf-Postgres, rollt dann aus |
| `n8n-deploy.yml` | Push auf `main` unter `n8n-workflows/**` | spielt die Workflows per REST-API zurück |
| `n8n-backup.yml` | täglich 03:17 UTC | zieht Drift aus der n8n-Oberfläche ins Repo |

Benötigte Secrets stehen in [CLAUDE.md](CLAUDE.md#benötigte-github-secrets).

## Weiterlesen

[CLAUDE.md](CLAUDE.md) erklärt die Architekturentscheidungen — warum die
Mandantentrennung so aussieht, warum `request_action` nichts ausführt, warum
der Export über den Namenspräfix filtert und nicht über Tags.
