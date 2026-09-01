# n8n Workflows

Exportierte Workflow-Definitionen der Hostinger-VPS-Instanz, eine Datei pro
Workflow.

Diese Dateien sind **generiert, aber verbindlich**: `n8n-backup.yml` zieht sie
per `GET /api/v1/workflows` und committet Änderungen, `n8n-deploy.yml` spielt
sie bei Push per `PUT /api/v1/workflows/:id` zurück. Wer hier von Hand editiert,
ändert damit die laufende Instanz.

n8n's native Git-Environments sind Enterprise-only und stehen auf der
Community-Instanz nicht zur Verfügung — daher der REST-API-Sync.

## Ablage

Der Ordner sagt, wer den Workflow startet — die einzige Unterscheidung, die
sich aus der Datei selbst ablesen lässt (und die der Export-Job für neue
Workflows automatisch anwendet):

| Ordner | Trigger | Wer ruft auf |
|---|---|---|
| `webhooks/` | `n8n-nodes-base.webhook` | das Next.js-Backend über HTTP |
| `sub-workflows/` | `n8n-nodes-base.executeWorkflowTrigger` | ein anderer Workflow |

## Aktueller Stand

### `webhooks/` — Einstiegspunkte des Backends

| Datei | Pfad | Workflow-ID | Status |
|---|---|---|---|
| `agent-turn.json` | `norra/agent-turn` | `yTH3YQeR5qdNVxSI` | angelegt, **nicht aktiviert** |
| `voice-turn.json` | `norra/voice-turn` | `wc4s77ROyul5LR5X` | angelegt, **nicht aktiviert** |
| `kb-ingest.json` | `norra/kb-ingest` | `Q3XhlP6eet9eqnm0` | angelegt, **nicht aktiviert** |

### `sub-workflows/` — vom Agent bzw. von einem Workflow aufgerufen

| Datei | Aufrufer | Workflow-ID | Status |
|---|---|---|---|
| `lookup-record.json` | Agent-Tool `lookup_record` | `KHHKDV5CoyiDxuCO` | angelegt, Endpunkt kommt pro Agent |
| `escalate-to-human.json` | Agent-Tool `escalate_to_human` | `pw6OzhBSG2oxagNt` | angelegt |
| `request-action.json` | Agent-Tool `request_action` | `LwyJZr8WFsjd0L9v` | angelegt |
| `notify-escalation.json` | `escalate-to-human` | `zU1x0scrqFmPClmg` | angelegt, braucht `organizations.escalation_email` |

Die drei Agent-Tools sind der Katalog aus `frontend/src/lib/tools.ts`;
`notify-escalation` ist kein Tool, sondern der Mail-Versand, den
`escalate-to-human` anstößt.

Die Workflow-ID steht in jeder Datei unter `norra.workflowId` — daran hängt der
Deploy-Job seinen `PUT /api/v1/workflows/:id` auf. Wer eine Datei ohne diesen
Block anlegt, wird nie deployt: der Sync legt bewusst nichts an.

`voice-turn.json` teilt sich Tools, Wissensbasis und System-Prompt mit
`agent-turn.json` und unterscheidet sich in drei Punkten, die alle aus einer
Tatsache folgen — ein Anrufer hört nichts, bevor ein Satz fertig ist: kein
Streaming, engere Grenzen (fünf statt zehn Iterationen, drei statt fünf
Treffer, knappes Token-Limit) und ein Rückgabewert `{reply, action}` statt
eines Streams.
