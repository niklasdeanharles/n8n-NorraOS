# Norra

Die Norra-Plattform liegt in zwei getrennten Hälften. Sie sind bewusst
getrennt, weil sie unterschiedlich schnell und aus unterschiedlichen Gründen
geändert werden: das Schema und die Agentenlogik hinten, die Oberfläche und
die Webhook-Routen vorne.

```
norra/
├── backend/     Supabase-Schema, RLS, Vektor-Suche, n8n-Workflows, Sync-Skripte
└── frontend/    Next.js-App: Betreiber-Konsole, Web-Widget, Telefon-Webhooks
```

Beide Ordner sind vollständige, für sich lauffähige Repositories: eigenes
`README.md`, eigenes `CLAUDE.md`, eigenes `.gitignore`, eigene
`.github/workflows/`. Wer sie herauslösen will, kopiert den Ordner und hat ein
fertiges Repository — es fehlt nichts.

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
cd norra/backend && node scripts/check-wiring.mjs
```

Das Skript findet die App von selbst, sowohl in dieser Anordnung
(`backend/` + `frontend/`) als auch wenn beide als eigene Repositories
nebeneinander liegen (`norra-backend/` + `norra-frontend/`).

## CI

Norra hängt hier im n8n-Fork, und GitHub liest Workflows ausschließlich aus
dem Repository-Wurzelverzeichnis. Deshalb gibt es sie zweimal:

| Ort | Läuft |
|---|---|
| `/.github/workflows/norra-*.yml` | jetzt, in diesem Fork — mit `norra/`-Pfaden und `paths:`-Filtern, damit sie auf n8n-eigene Änderungen nie feuern |
| `norra/backend/.github/workflows/`, `norra/frontend/.github/workflows/` | sobald der jeweilige Ordner ein eigenes Repository ist — ohne Präfix, mit `main` statt `master` |

Inhaltlich sind es dieselben Jobs. Ändert sich einer, gehört der andere
nachgezogen.

## Prüfen

```bash
cd norra/frontend
npm ci
npm run typecheck && npm run lint
node tests/voice/run.mjs     # 16 Szenarien: Anruf → Turn → Weiterleitung → Status
node tests/widget/run.mjs    # 13 Szenarien: Session → Turn → Token-Angriffe → Bewertung
node tests/simulate/run.mjs  # 12 Szenarien: Testfälle als angemeldeter Admin
```

```bash
cd norra/backend/supabase
psql -v ON_ERROR_STOP=1 -f tests/bootstrap.local.sql
for f in migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -f "$f"; done
for t in tenancy governance phone; do psql -v ON_ERROR_STOP=1 -f "tests/$t.test.sql"; done
```

Die Details stehen in `backend/CLAUDE.md` und `frontend/CLAUDE.md`.
