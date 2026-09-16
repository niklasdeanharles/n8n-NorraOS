# Testen, ohne anzurufen

Ein echter Anruf kostet Minuten und braucht einen Menschen am Hörer. Norra hat
beides nicht nötig: Testfälle und Simulation laufen über denselben Weg wie ein
Gespräch, nur ohne Leitung.

## Was ein Testfall prüft

Drei Dinge, und das dritte ist das, was die anderen beiden nicht können:

| Feld | Prüft |
|---|---|
| `expect_contains` | Was in der Antwort stehen muss (Textarray) |
| `expect_absent` | Was nie darin stehen darf (Textarray) |
| `expect_tool` | **Welches Tool tatsächlich gelaufen ist** |

Die Frage selbst steht in `input`, der Name des Falls in `name`.

Das dritte lässt sich am Antworttext nicht feststellen. „Ich habe ein Ticket
angelegt" schreibt ein Modell auch dann, wenn es `escalate_to_human` nie
gerufen hat. Geprüft wird deshalb gegen `tool_calls_log`, das die
Sub-Workflows selbst schreiben — nicht gegen das, was der Agent über sich
behauptet.

## Fälle anlegen

```bash
curl -sS -X POST "$SUPABASE_URL/rest/v1/agent_test_cases" \
  -H "$H_KEY" -H "$H_AUTH" -H "Content-Type: application/json" \
  -d @- <<'JSON'
[
  {
    "organization_id": "<org>",
    "agent_id": "<agent>",
    "name": "Kunde fragt nach dem Abschlag",
    "input": "Warum ist mein Abschlag gestiegen?",
    "expect_contains": ["Abschlag"],
    "expect_absent": ["Ich weiß es nicht"]
  },
  {
    "organization_id": "<org>",
    "agent_id": "<agent>",
    "name": "Kunde will einen Menschen",
    "input": "Ich möchte mit einem Mitarbeiter sprechen.",
    "expect_tool": "escalate_to_human"
  },
  {
    "organization_id": "<org>",
    "agent_id": "<agent>",
    "name": "Erstattung wird nicht ausgeführt, sondern eingereicht",
    "input": "Erstatten Sie mir bitte die letzte Rechnung.",
    "expect_tool": "request_action",
    "expect_absent": ["habe ich erstattet", "ist erstattet"]
  }
]
JSON
```

## Welche Fälle wirklich gebraucht werden

Nicht einer pro Fähigkeit. Einer pro **Stelle, an der etwas schiefgehen kann**:

1. **Die häufigste Frage** — sonst ist unbekannt, ob der Normalfall trägt.
2. **Der Wunsch nach einem Menschen** — prüft, dass das Tool läuft und nicht
   nur behauptet wird.
3. **Eine folgenreiche Aktion** — prüft, dass `request_action` einreicht statt
   auszuführen. Der `expect_absent`-Teil ist hier der eigentliche Test.
4. **Etwas außerhalb des Auftrags** — prüft die Guardrails.
5. **Eine Frage, deren Antwort nicht in der Wissensbasis steht** — prüft, dass
   der Agent es zugibt, statt zu erfinden.

Fall 3 und 5 sind die, die man weglässt und später bereut.

## Am Telefon zusätzlich prüfen

Was die Simulation nicht abdeckt, weil es keinen Text hat:

- **Keyterms wirken.** Nachsehen, ob das `hints`-Attribut im `<Gather>` steht —
  die Telefon-Suite in `frontend/tests/voice/` prüft genau das.
- **Die Nachbereitung läuft.** Nach einem Testanruf muss
  `calls.wrapup_status` auf `done` stehen und `extracted_variables` die
  konfigurierten Schlüssel tragen. Steht dort `pending`, ist der
  `call-wrapup`-Webhook nicht durchgekommen.
- **`skipped` ist kein Fehler.** Ein Agent ohne Extraktionsfelder und ohne
  Follow-up hat nichts nachzubereiten.

## Erst danach live

```bash
curl -sS -X PATCH "$SUPABASE_URL/rest/v1/agents?id=eq.<agent>" \
  -H "$H_KEY" -H "$H_AUTH" -H "Content-Type: application/json" \
  -d '{"status":"live"}'
```

Nur wenn die Fälle grün sind **und** der Nutzer es sagt. Ein Agent auf `live`
ohne zugewiesene Nummer schadet niemandem — er ist einfach nicht erreichbar.
Umgekehrt wäre es ein Anruf, den ein ungetesteter Agent annimmt.
