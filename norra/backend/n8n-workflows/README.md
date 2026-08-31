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
| `voice-turn.json` | `wc4s77ROyul5LR5X` | angelegt, **nicht aktiviert** |
| `kb-ingest.json` | `Q3XhlP6eet9eqnm0` | angelegt, **nicht aktiviert** |
| `tool-lookup-record.json` | `KHHKDV5CoyiDxuCO` | angelegt, Endpunkt kommt pro Agent |
| `tool-escalate-to-human.json` | `pw6OzhBSG2oxagNt` | angelegt |
| `tool-request-action.json` | `LwyJZr8WFsjd0L9v` | angelegt |
| `notify-escalation.json` | `zU1x0scrqFmPClmg` | angelegt, braucht `organizations.escalation_email` |

Die Workflow-ID steht in jeder Datei unter `norra.workflowId` — daran hängt der
Deploy-Job seinen `PUT /api/v1/workflows/:id` auf. Wer eine Datei ohne diesen
Block anlegt, wird nie deployt: der Sync legt bewusst nichts an.

`voice-turn.json` teilt sich Tools, Wissensbasis und System-Prompt mit
`agent-turn.json` und unterscheidet sich in drei Punkten, die alle aus einer
Tatsache folgen — ein Anrufer hört nichts, bevor ein Satz fertig ist: kein
Streaming, engere Grenzen (fünf statt zehn Iterationen, drei statt fünf
Treffer, knappes Token-Limit) und ein Rückgabewert `{reply, action}` statt
eines Streams.
