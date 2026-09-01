# NorraOS

Die Norra-Plattform: ein KI-Support-Agent, der über Web-Widget und Telefon
erreichbar ist, mit einer Konsole zum Bauen, Testen und Überwachen.

Sie liegt in zwei getrennten Hälften. Sie sind bewusst
getrennt, weil sie unterschiedlich schnell und aus unterschiedlichen Gründen
geändert werden: das Schema und die Agentenlogik hinten, die Oberfläche und
die Webhook-Routen vorne.

```
NorraOS/
├── backend/     Supabase-Schema, RLS, Vektor-Suche, n8n-Workflows, Sync-Skripte
└── frontend/    Next.js-App: Betreiber-Konsole, Web-Widget, Telefon-Webhooks
```

Jeder Ordner steht für sich: eigenes `README.md`, eigenes `CLAUDE.md`, eigenes
`.gitignore`, eigene Abhängigkeiten. Die CI liegt gemeinsam unter
`.github/workflows/`, weil GitHub Workflows ausschließlich aus dem
Repository-Wurzelverzeichnis liest.

## Was wo hingehört

| Frage | Antwort |
|---|---|
| Eine neue Spalte, ein neues Tool, ein anderer Prompt | `backend/` |
| Ein neuer Screen, eine neue Route, ein anderes Label | `frontend/` |
| Ein Feld, das die App schickt und ein Workflow liest | beide — und `backend/scripts/check-wiring.mjs` sagt, wenn nur eine Seite nachgezogen wurde |

Die Grenze ist keine Konvention, sondern geprüft: `check-wiring.mjs`
vergleicht Webhook-Pfade, Payload-Felder und jeden Spaltennamen, den eine
API-Route nennt, gegen die Migrationen und die Workflow-JSONs.

```bash
cd backend && node scripts/check-wiring.mjs
```

Das Skript findet die App von selbst, sowohl in dieser Anordnung
(`backend/` + `frontend/`) als auch wenn beide als eigene Repositories
nebeneinander liegen (`norra-backend/` + `norra-frontend/`).

## CI

Vier Workflows, alle in `.github/workflows/`, jeder mit `paths:`-Filtern, damit
eine Änderung am Frontend keinen Datenbank-Rollout auslöst:

| Workflow | Auslöser | Wirkung |
|---|---|---|
| `app-checks.yml` | Änderungen an `frontend/` oder am Schema | typecheck, lint, Verdrahtung, vier End-to-End-Suiten |
| `db-migrate.yml` | Änderungen an `backend/supabase/` | prüft die Migrationen gegen ein Wegwerf-Postgres, rollt dann aus |
| `n8n-deploy.yml` | Änderungen an `backend/n8n-workflows/` | schiebt die Workflow-Definitionen auf die n8n-Instanz |
| `n8n-backup.yml` | täglich | holt die Workflows von der Instanz und committet, was abgedriftet ist |

Der letzte ist der, der das Leitprinzip durchsetzt: was jemand in der n8n-UI
zusammenklickt, landet spätestens am nächsten Morgen als Commit in git — oder
es gibt keine Drift.

## Prüfen

```bash
cd frontend
npm ci
npm run typecheck && npm run lint
node tests/voice/run.mjs     # 16 Szenarien: Anruf → Turn → Weiterleitung → Status
node tests/widget/run.mjs    # 13 Szenarien: Session → Turn → Token-Angriffe → Bewertung
node tests/simulate/run.mjs  # 12 Szenarien: Testfälle als angemeldeter Admin
node tests/console/run.mjs   # 17 Szenarien: Agent-Turn und Wissens-Ingest
```

```bash
cd backend/supabase
psql -v ON_ERROR_STOP=1 -f tests/bootstrap.local.sql
for f in migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -f "$f"; done
for t in tenancy governance phone; do psql -v ON_ERROR_STOP=1 -f "tests/$t.test.sql"; done
```

Die Details stehen in `backend/CLAUDE.md` und `frontend/CLAUDE.md`.
