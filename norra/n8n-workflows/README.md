# n8n Workflows

Exportierte Workflow-Definitionen der Hostinger-VPS-Instanz, eine Datei pro
Workflow (`<slug>.json`).

Diese Dateien sind **generiert, aber verbindlich**: `norra-n8n-backup.yml` zieht
sie per `GET /api/v1/workflows` und committet Änderungen, `norra-n8n-deploy.yml`
spielt sie bei Push per `PUT /api/v1/workflows/:id` zurück. Wer hier von Hand
editiert, ändert damit die laufende Instanz.

n8n's native Git-Environments sind Enterprise-only und stehen auf der
Community-Instanz nicht zur Verfügung — daher der REST-API-Sync.

## Aktueller Stand

| Datei | Workflow-ID | Status |
|---|---|---|
| `agent-turn.json` | `yTH3YQeR5qdNVxSI` | angelegt, **nicht aktiviert** |
| `kb-ingest.json` | `Q3XhlP6eet9eqnm0` | angelegt, **nicht aktiviert** |
| `tool-lookup-order.json` | `KHHKDV5CoyiDxuCO` | angelegt, Shop-URL fehlt |
| `tool-escalate-to-human.json` | `pw6OzhBSG2oxagNt` | angelegt |
| `tool-create-refund.json` | `LwyJZr8WFsjd0L9v` | angelegt |
| `notify-escalation.json` | `zU1x0scrqFmPClmg` | angelegt, braucht `settings.escalation_email` |

Die Workflow-ID steht in jeder Datei unter `meta.norraWorkflowId` — daran hängt
der Deploy-Job aus Phase 3 seinen `PUT /api/v1/workflows/:id` auf.

`agent-turn.json` und `kb-ingest.json` sind exakte Abzüge der Instanz. Die drei
Tool-Dateien wurden aus demselben Quellcode geschrieben, aus dem sie angelegt
wurden, tragen aber noch keine servergenerierten Node-IDs; der Backup-Job aus
Phase 3 ersetzt sie beim ersten Lauf durch die kanonische Fassung.
