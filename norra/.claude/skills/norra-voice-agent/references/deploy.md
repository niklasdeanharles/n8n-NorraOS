# Anlegen

Die genaue Schreibreihenfolge. Jede Zeile trägt die `organization_id` aus
Phase 1.

Alle Aufrufe gegen PostgREST mit dem Service-Role-Key:

```bash
H_AUTH="Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
H_KEY="apikey: $SUPABASE_SERVICE_ROLE_KEY"
```

## 1. Der Agent

```bash
curl -sS -X POST "$SUPABASE_URL/rest/v1/agents" \
  -H "$H_KEY" -H "$H_AUTH" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d @- <<'JSON'
{
  "organization_id": "<org>",
  "name": "Lina",
  "slug": "lina",
  "description": "Telefonische Erstannahme für Lumen Energie",
  "system_prompt": "<aus Phase 2>",
  "model": "claude-opus-5",
  "temperature": 0.2,
  "max_tokens": 4096,
  "channels": ["voice"],
  "tools": [
    { "slug": "identify_caller", "enabled": true },
    { "slug": "escalate_to_human", "enabled": true },
    { "slug": "transfer_to_department", "enabled": true }
  ],
  "guardrails": {
    "forbidden_topics": ["Rechtsberatung", "Vertragskündigung am Telefon"],
    "refusal_message": "Dazu darf ich am Telefon nichts sagen. Ich verbinde Sie gern mit einem Mitarbeiter."
  },
  "escalation_rules": { "on_low_confidence": true, "on_keywords": ["Anwalt", "Beschwerde"] },
  "voice_config": {
    "keyterms": ["Wärmepumpe", "Abschlagszahlung", "Zählerstand"],
    "extract": [
      { "name": "kundennummer", "prompt": "Die Kundennummer, falls der Anrufer sie nennt." },
      { "name": "anliegen", "prompt": "Das Anliegen in höchstens drei Wörtern." }
    ],
    "followup": { "target": "email", "address": "service@lumen.example" }
  }
}
JSON
```

`status` wird **nicht** gesetzt. Der Default ist `draft`, und ihn wegzulassen
ist ehrlicher, als ihn hinzuschreiben: er ist keine Entscheidung dieser Skill.

Die Antwort trägt die `id`. Sie wird für alles Weitere gebraucht.

### Grenzen, die die Datenbank zieht

| Feld | Regel |
|---|---|
| `slug` | `^[a-z0-9][a-z0-9-]{0,62}$`, eindeutig pro Organisation |
| `temperature` | 0 bis 2 |
| `max_tokens` | 1 bis 200000 |
| `channels` | mindestens ein Eintrag |
| `voice_config.keyterms` | höchstens 50, je 1–60 Zeichen, kein Komma |
| `voice_config.extract[].name` | `^[a-z][a-z0-9_]{0,48}$` |
| `voice_config.extract[].prompt` | 1–400 Zeichen, Pflicht |
| `voice_config.followup` | nur `target: "email"` mit zustellbarer Adresse |

Ein unbekannter Schlüssel in `voice_config` wird **abgelehnt**, nicht ignoriert.
Ein stillschweigend angenommener Tippfehler wäre eine Einstellung, die nie
wirkt.

## 2. Abteilungen (nur bei `transfer_to_department`)

```bash
curl -sS -X POST "$SUPABASE_URL/rest/v1/phone_departments" \
  -H "$H_KEY" -H "$H_AUTH" -H "Content-Type: application/json" \
  -d '[{"organization_id":"<org>","name":"Buchhaltung","e164":"+493011111111",
        "description":"Rechnungen und Mahnungen","active":true}]'
```

Ohne Zeile hier verbindet das Tool niemanden — es gibt einen Namen zurück, den
`/api/voice/turn` nachschlägt, und ein Name ohne Zeile führt zu keiner
Verbindung. Das ist so gewollt.

## 3. Wissensbasis

Zwei Schritte, und der erste ist nicht optional: der Workflow schreibt seine
Chunks gegen eine **bestehende** Zeile in `knowledge_base_documents` und
braucht deren `document_id`.

```bash
DOC=$(curl -sS -X POST "$SUPABASE_URL/rest/v1/knowledge_base_documents" \
  -H "$H_KEY" -H "$H_AUTH" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"organization_id":"<org>","agent_id":"<agent>","title":"Häufige Fragen",
       "source_type":"text","status":"pending",
       "checksum":"<sha256 des Inhalts>"}' | jq -r '.[0].id')
```

Der `checksum` ist der SHA-256 des Inhalts. Er ist kein Beiwerk: ein
Eindeutigkeitsindex liegt darauf, und er ist der Grund, warum ein zweites
Einlesen desselben Textes nicht jeden Chunk verdoppelt.

```bash
curl -sS -X POST "$N8N_BASE_URL/webhook/norra/kb-ingest" \
  -H "x-norra-secret: $N8N_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"organization_id\":\"<org>\",\"document_id\":\"$DOC\",
       \"agent_id\":\"<agent>\",\"title\":\"Häufige Fragen\",\"content\":\"...\"}"
```

Einfacher ist der Weg über die App: `POST /api/kb-ingest` als angemeldeter
Admin macht beide Schritte, bildet den Checksum selbst und markiert das
Dokument als `failed`, wenn n8n nicht antwortet — statt es verschwinden zu
lassen.

> Dieser eine Aufruf braucht das Webhook-Secret. Es steht in der Umgebung des
> Nutzers, nicht in dieser Skill — und wird auch hier nicht ausgegeben.

Geht das nicht, ist das kein Grund zum Abbruch: die Fakten stehen bereits im
System-Prompt. Sag es und mach weiter.

## 4. Nummer zuweisen — erst nach Bestätigung

```bash
curl -sS -X PATCH "$SUPABASE_URL/rest/v1/phone_numbers?id=eq.<nummer-id>" \
  -H "$H_KEY" -H "$H_AUTH" -H "Content-Type: application/json" \
  -d '{"agent_id":"<agent>","greeting":"Guten Tag, hier ist Lina von Lumen Energie. Was kann ich für Sie tun?",
       "voice":"Polly.Vicki-Neural","language":"de-DE","timezone":"Europe/Berlin",
       "business_hours":{"mon":["09:00","17:00"],"tue":["09:00","17:00"]},
       "after_hours":"transfer","transfer_number":"+4930999888777"}'
```

Eine Nummer auf `status: "active"` zu setzen heißt: ab jetzt klingelt es. Das
ist der Schritt, der einzeln bestätigt wird — und die Datenbank verweigert ihn
ohnehin, solange kein Agent zugewiesen ist.

**Eine Nummer kaufen** ist kein Schritt dieser Skill. Das passiert beim
Telefonanbieter, kostet Geld und gehört dem Nutzer.

## 5. Nachweisen, dass die Instanz bereit ist

```bash
cd backend && node scripts/preflight.mjs
```

Meldet fehlende Workflows, inaktive Webhooks, Nodes ohne die Credential, die
ihr Typ verlangt, und offene Tool-Verweise. Exit 1, solange etwas blockiert.
