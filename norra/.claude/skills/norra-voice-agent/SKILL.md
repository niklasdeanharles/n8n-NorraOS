---
name: norra-voice-agent
description: Baut aus einer kurzen Beschreibung (optional zusätzlich einer Website-URL) einen vollständigen KI-Telefonassistenten auf Norras eigenem Stack — Supabase, n8n und Twilio, ohne Plattformgebühr und ohne fremden Account. Schreibt den System-Prompt, zieht Fakten aus der Website, wählt die Tools, richtet Keyterms für die Spracherkennung, Variablenextraktion und Follow-up ein, legt den Agenten als Entwurf an und testet ihn ohne einen einzigen echten Anruf. Nutze diese Skill, wenn jemand einen Norra-Telefonassistenten bzw. Voice Agent bauen, aufsetzen oder live schalten will.
---

# Norra Voice Agent Builder

Baut einen produktionsreifen Telefonassistenten **auf Norras eigenem Stack**:
das Schema in Supabase, die Agentenlogik im n8n-Workflow `voice-turn`, die
Leitung über Twilio. Kein Plattform-Abo, kein fremder Account, keine zweite
Stelle, an der Logik liegt.

> **Was das kostet und was nicht.** Die Plattformschicht ist frei — sie gehört
> dir und liegt in diesem Repository. Geld kosten nur die Nummer und die
> Gesprächsminuten beim Telefonanbieter sowie die Claude-Tokens. Das ist der
> Unterschied zu einer Voice-Agent-SaaS, und es ist der einzige.

---

## Leitplanken (immer, nicht überschreibbar)

1. **Keine Secrets ins Repository.** `SUPABASE_SERVICE_ROLE_KEY`,
   `N8N_WEBHOOK_SECRET`, Twilio-Token und der Anthropic-Key kommen
   ausschließlich aus der Umgebung. Niemals ausgeben, loggen, in eine Datei
   schreiben oder ins Transkript spiegeln. Auch nicht maskiert: eine maskierte
   Zeichenkette verrät ihre Länge.
2. **Entwurf zuerst.** Ein neuer Agent wird mit `status: 'draft'` angelegt —
   das ist der Default der Spalte, also nicht einmal eine Entscheidung. Auf
   `live` erst nach bestandenem Test **und** ausdrücklicher Bestätigung.
3. **Was Geld kostet, wird einzeln bestätigt.** Eine Nummer kaufen, eine Nummer
   einer Organisation zuweisen, einen echten Anruf auslösen. Der Test in Phase 6
   kostet nichts.
4. **Der Mandant ist nie ein Modellfeld.** Jede Zeile, die diese Skill
   schreibt, trägt die `organization_id` des Nutzers. Sie wird einmal am Anfang
   festgestellt und danach nicht mehr aus einer Antwort übernommen.
5. **Umlaute-Pflicht.** Alles, was gesprochen oder angezeigt wird, mit echten
   `ä ö ü ß`. Einzige Ausnahme: Variablennamen in `voice_config.extract` —
   die sind `snake_case` ohne Umlaute, weil sie zu Schlüsseln in einer Abfrage
   werden.
6. **Nichts erfinden.** Öffnungszeiten, Preise, Zusagen kommen aus der
   gecrawlten Website oder vom Nutzer. Ein Modell, das eine Telefonnummer oder
   einen Erstattungsbetrag halluziniert, richtet realen Schaden an.

---

## Setup (einmal pro Nutzer)

Folge `references/setup.md`. Kurz: die Umgebung muss `SUPABASE_URL` und
`SUPABASE_SERVICE_ROLE_KEY` kennen, und für den Livegang zusätzlich eine
laufende n8n-Instanz mit den Workflows aus `backend/n8n-workflows/`.

Fehlt etwas davon, sag welches Stück fehlt und wie es gesetzt wird — frag den
Wert **nicht** im Chat ab.

---

## Der 6-Phasen-Flow

### Phase 1 — Intake

`references/intake.md`. Einstieg ist immer: **„Was soll dein Telefonassistent
können?"** Daraus die Fähigkeiten ableiten.

Eine Website ist optional. Gibt es eine, per `WebFetch` crawlen und Fakten
ziehen; gibt es keine, die Kernfakten direkt erfragen. Danach nur noch die
**Lücken** abfragen: Firmenname, Name des Assistenten, Sprache,
Öffnungszeiten, wohin die Zusammenfassung nach dem Anruf geht, woher die
Wissensbasis kommt.

Bestätigungs-Block, dann weiter.

### Phase 2 — System-Prompt

`references/prompt-engine.md`. Der Norra-Standard für Telefon-Prompts: eine
Frage pro Zug, kurze Sätze, exakte Tool-Namen mit *wann*, Datumsaussprache,
Guardrails. Die Begrüßung entsteht aus Name und Firma, nicht aus einer Vorlage.

Am Telefon gilt zusätzlich, was im Chat egal ist: **jeder Satz wird gesprochen,
bevor der nächste beginnt.** Ein Prompt, der zu Aufzählungen verleitet, macht
den Anruf doppelt so lang.

### Phase 3 — Fähigkeiten und Tools

Sieben Tools gibt es (`frontend/src/lib/tools.ts`). Drei laufen überall, vier
nur am Telefon:

| Tool | Kanal | Wofür |
|---|---|---|
| `lookup_record` | beide | Datensatz beim Kunden nachschlagen, read-only |
| `escalate_to_human` | beide | Ticket anlegen, Konversation eskalieren |
| `request_action` | beide | Folgenreiche Aktion zur **Freigabe** einreichen — führt nichts aus |
| `identify_caller` | Telefon | Anrufer an seiner Nummer erkennen |
| `send_sms` | Telefon | SMS an den Anrufer |
| `schedule_callback` | Telefon | Rückruf notieren |
| `transfer_to_department` | Telefon | An eine Fachabteilung durchstellen |

Braucht eine gewünschte Fähigkeit einen fremden Dienst, ist das
`lookup_record` mit einer URL in `tools[].config.url` — nicht ein neuer
Workflow. Erst wenn die Fähigkeit wirklich etwas anderes tut, wird ein
Sub-Workflow gebaut; dann gilt `backend/n8n-workflows/README.md`.

### Phase 4 — Telefon-Feinschliff

Das, was ein Telefonassistent zusätzlich zu einem Chat-Agenten hat. Alles drei
landet in `agents.voice_config`:

- **Keyterms** — die Wörter, an denen sich eine Telefonleitung verhört.
  Produktnamen, Fachbegriffe, Eigennamen. Aus der Website ableiten, nicht
  erfinden. Höchstens 50; eine längere Liste schärft nicht, sie verwässert.
- **Extraktionsschema** — was nach dem Gespräch strukturiert vorliegen soll,
  als `{name, prompt}`. Der Name wird zum Schlüssel in `calls.extracted_variables`,
  also `snake_case`. Die Beschreibung sagt dem Modell, wonach es sucht.
- **Follow-up** — eine E-Mail-Adresse oder nichts.

Leer lassen ist eine gültige Antwort: ein Agent ohne Extraktion und ohne
Follow-up telefoniert trotzdem, die Nachbereitung wird dann als `skipped`
vermerkt.

### Phase 5 — Anlegen (als Entwurf)

`references/deploy.md`. Die genaue Schreibreihenfolge in Supabase. Kurz:
eine Zeile in `agents` mit `channels: ['voice']`, dann die Wissensbasis über
den `kb-ingest`-Webhook, dann optional die Zuordnung einer Nummer in
`phone_numbers`.

**Alle Felder aktiv füllen.** Ein Feld auf Default zu lassen, weil es gerade
nicht wichtig scheint, ist genau das, was später als leerer Screen auffällt.

### Phase 6 — Testen, dann live

Norra hat den Test schon: **Testfälle** (`agent_test_cases`) und die
**Simulation** auf der Agenten-Seite. Ein Fall prüft dreierlei — was die
Antwort enthalten muss, was sie nie enthalten darf, und **welches Tool
tatsächlich gelaufen ist**, geprüft gegen `tool_calls_log` statt gegen den
Antworttext. Ein Modell schreibt „ich habe ein Ticket angelegt" auch dann,
wenn es `escalate_to_human` nie gerufen hat.

Das kostet keine Telefonminute. Erst wenn die Fälle grün sind **und** der
Nutzer bestätigt: `status: 'live'`, und getrennt davon die Zuweisung einer
Nummer.

Die Startbereitschaft der Instanz prüft `backend/scripts/preflight.mjs` — es
meldet fehlende Credentials, inaktive Webhooks und offene Tool-Verweise, bevor
ein Kunde in der Leitung ist.

---

## Referenzdateien (bei Bedarf lesen)

- `references/setup.md` — was die Umgebung kennen muss, und was nicht.
- `references/intake.md` — Website-Crawl und Fragebogen.
- `references/prompt-engine.md` — der Norra-Standard für Telefon-Prompts.
- `references/deploy.md` — exakte Schreibreihenfolge und Feldformen.
- `references/testing.md` — Testfälle bauen und auswerten, ohne anzurufen.
