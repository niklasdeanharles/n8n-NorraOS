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
| `identify-caller.json` | Agent-Tool `identify_caller` | **noch keine** | nur Telefon |
| `send-sms.json` | Agent-Tool `send_sms` | **noch keine** | nur Telefon, braucht Twilio-Credential in n8n |
| `schedule-callback.json` | Agent-Tool `schedule_callback` | **noch keine** | nur Telefon |
| `transfer-to-department.json` | Agent-Tool `transfer_to_department` | **noch keine** | nur Telefon, braucht Einträge in `phone_departments` |

Die sieben Agent-Tools sind der Katalog aus `frontend/src/lib/tools.ts`;
`notify-escalation` ist kein Tool, sondern der Mail-Versand, den
`escalate-to-human` anstößt.

### Die vier Telefon-Tools

Sie brauchen alle eine `call_id` und stehen deshalb nur im Voice-Agenten, nicht
im Chat. Was sie gemeinsam haben, ist wichtiger als was sie unterscheidet:

**Das Modell bestimmt die Worte, nie das Ziel.** `send_sms` bekommt einen Text,
aber die Empfängernummer kommt aus `calls.from_e164`. `identify_caller` bekommt
eine `call_id`, keine Rufnummer — sonst wäre es eine freie Abfrage auf die
Kontaktliste des Mandanten. `transfer_to_department` gibt einen Abteilungsnamen
zurück, keine Nummer; `/api/voice/turn` schlägt ihn ein zweites Mal in
`phone_departments` nach, unmittelbar vor dem Wählen. Eine vom Modell erfundene
Nummer kann damit nirgends gewählt werden — es gibt keinen Pfad, auf dem sie
ankäme.

### Neue Sub-Workflows in Betrieb nehmen

Der Deploy-Job legt bewusst nichts an. Die vier neuen Dateien haben deshalb noch
keine `norra.workflowId`:

1. In n8n: **Workflows → Import from File**, je eine Datei.
2. `node scripts/n8n-sync.mjs export` holt sie mitsamt ihrer neuen ID zurück.
3. Beim nächsten Deploy löst der Sync die Tool-Verweise im Voice-Agenten
   automatisch am Namen auf — IDs müssen nirgends von Hand eingetragen werden.

Fehlt einer der vier auf der Instanz, bricht `deploy` ab und nennt ihn beim
Namen, statt einen Agenten mit einem Tool live zu schalten, das ins Leere zeigt.
`check-wiring.mjs` fängt denselben Fehler schon im Pull Request.

Die Workflow-ID steht in jeder Datei unter `norra.workflowId` — daran hängt der
Deploy-Job seinen `PUT /api/v1/workflows/:id` auf. Wer eine Datei ohne diesen
Block anlegt, wird nie deployt: der Sync legt bewusst nichts an.

`voice-turn.json` teilt sich Tools, Wissensbasis und System-Prompt mit
`agent-turn.json` und unterscheidet sich in drei Punkten, die alle aus einer
Tatsache folgen — ein Anrufer hört nichts, bevor ein Satz fertig ist: kein
Streaming, engere Grenzen (fünf statt zehn Iterationen, drei statt fünf
Treffer, knappes Token-Limit) und ein Rückgabewert `{reply, action}` statt
eines Streams.
