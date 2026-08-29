# n8n Workflows

Exportierte Workflow-Definitionen der Hostinger-VPS-Instanz, eine Datei pro
Workflow (`<slug>.json`).

Diese Dateien sind **generiert, aber verbindlich**: `norra-n8n-backup.yml` zieht
sie per `GET /api/v1/workflows` und committet Änderungen, `norra-n8n-deploy.yml`
spielt sie bei Push per `PUT /api/v1/workflows/:id` zurück. Wer hier von Hand
editiert, ändert damit die laufende Instanz.

n8n's native Git-Environments sind Enterprise-only und stehen auf der
Community-Instanz nicht zur Verfügung — daher der REST-API-Sync.
