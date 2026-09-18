# norra-voice-agent

Baut einen Telefonassistenten auf Norras eigenem Stack — Supabase, n8n,
Twilio — statt auf einer Voice-Agent-SaaS.

Der Unterschied zu einer gehosteten Plattform ist nicht die Fähigkeit, sondern
wo die Logik liegt: der System-Prompt in `agents.system_prompt`, der Ablauf im
n8n-Workflow `voice-turn`, die Nachbereitung in `call-wrapup`. Alles davon
liegt in diesem Repository und ist versioniert. Es gibt keinen Zustand, der nur
durch Klicken in einer fremden UI entstanden ist.

**Frei ist die Plattformschicht, nicht die Leitung.** Eine Telefonnummer kostet
beim Anbieter Geld, Gesprächsminuten auch, und Claude-Tokens ebenso. Was
wegfällt, ist die Plattformgebühr.

## Dateien

| Datei | Inhalt |
|---|---|
| `SKILL.md` | Leitplanken und die sechs Phasen |
| `references/setup.md` | Was die Umgebung kennen muss — und was nie |
| `references/intake.md` | Website-Crawl und Fragebogen |
| `references/prompt-engine.md` | Der Norra-Standard für Telefon-Prompts |
| `references/deploy.md` | Schreibreihenfolge und Feldgrenzen |
| `references/testing.md` | Testfälle, ohne eine Minute zu telefonieren |

## Was sie nicht tut

- **Keine Nummer kaufen.** Das kostet Geld und gehört dem Nutzer.
- **Keinen Agenten live schalten**, ohne dass die Testfälle grün sind und der
  Nutzer zustimmt.
- **Keine Secrets anfassen.** Der Anthropic-Key, das Twilio-Token und
  `N8N_WEBHOOK_SECRET` leben in der Umgebung und in den n8n-Credentials. Ein
  Mensch legt sie an; `backend/scripts/preflight.mjs` sagt, welcher fehlt.
