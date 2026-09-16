# Intake

Die einzige Phase, in der der Nutzer redet und die Skill zuhört.

## Der Einstieg

Immer dieselbe Frage, egal was im Auftrag stand:

> **Was soll dein Telefonassistent können?**

Aus der Antwort ergeben sich die Fähigkeiten. Alles Weitere sind Lücken, die
gefüllt werden müssen — nicht Fragen, die gestellt werden, weil ein Formular
sie vorsieht.

## Website zuerst, Fragen danach

Gibt es eine Website, per `WebFetch` holen und daraus ziehen, was dort steht:

| Gesucht | Wofür |
|---|---|
| Firmenname, wie er ausgesprochen wird | Begrüßung |
| Was die Firma tut, in einem Satz | System-Prompt |
| Öffnungszeiten | `phone_numbers.business_hours` |
| Produkt- und Fachbegriffe | `voice_config.keyterms` |
| Abteilungen, Standorte | `phone_departments` |
| Häufige Fragen, Hilfeseiten | Wissensbasis |

**Was nicht dasteht, wird nicht angenommen.** Eine Website ohne Öffnungszeiten
heißt: nach den Öffnungszeiten fragen. Nicht: „Mo–Fr 9–17" einsetzen, weil das
üblich ist.

Die gefundenen Fakten zusätzlich in den System-Prompt einbetten, nicht nur in
die Wissensbasis: die Indexierung kann leer bleiben, der Prompt nicht.

## Die Lücken

Nur fragen, was weder aus der Beschreibung noch aus der Website hervorgeht:

1. **Firmenname** — wie er am Telefon gesagt werden soll.
2. **Name des Assistenten** — frei wählbar. Kein Default vorschlagen, ohne zu
   fragen; der Name ist das Erste, was ein Anrufer hört.
3. **Sprache** — `de-DE` als Vorgabe, aber genannt, nicht stillschweigend.
4. **Öffnungszeiten** und was außerhalb passiert: Agent, Weiterleitung,
   Anrufbeantworter.
5. **Nach dem Anruf** — Zusammenfassung an eine Adresse, oder keine.
6. **Wissensbasis** — Website, hochgeladene Dokumente, oder vorerst nichts.
7. **Was strukturiert herausfallen soll** — Bestellnummer, Anliegen,
   Rückrufwunsch. Wird zu `voice_config.extract`.

## Was ein Backend braucht

Nennt der Nutzer eine Fähigkeit, die einen fremden Dienst anfragt
(„Bestellstatus nachschlagen", „Termin im Kalender eintragen"), ist das
zunächst `lookup_record` mit einer URL. Dafür braucht es:

- die URL, zwingend `https://` — der Aufruf trägt Kundenkennungen,
- die Bestätigung, dass der Endpunkt read-only ist.

Schreibende Aktionen laufen **nicht** so. Sie gehen über `request_action`, das
ein Ticket plus eine Zeile in `approvals` anlegt und ausdrücklich nichts
ausführt. Warum, steht in `backend/CLAUDE.md` unter „Warum `request_action`
nichts ausführt".

## Der Bestätigungs-Block

Vor Phase 2 alles zusammenfassen, was gleich geschrieben wird — Firma, Name,
Sprache, Kanäle, Tools, Zeiten, Follow-up, Extraktionsfelder. Erst nach einem
Ja weiter.

Das ist kein Höflichkeitsschritt: ab Phase 5 entstehen Zeilen in der Datenbank
eines echten Mandanten.
