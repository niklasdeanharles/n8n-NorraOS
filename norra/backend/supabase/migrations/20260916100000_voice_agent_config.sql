-- Was ein Telefonat hinterlässt, wenn es vorbei ist.
--
-- Bisher endete ein Anruf mit einer Zeile in `calls` (Dauer, Status, Anzahl
-- Züge) und dem Transkript in `messages`. Das ist genug, um zu sehen, *dass*
-- telefoniert wurde, und zu wenig, um damit zu arbeiten: wer die Bestellnummer
-- aus dem Gespräch braucht, liest sie von Hand aus dem Transkript.
--
-- Drei Dinge fehlten, die ein Telefonassistent haben muss:
--
--   1. **Keyterms.** Am Telefon verhört sich die Spracherkennung genau bei den
--      Wörtern, auf die es ankommt — Produktnamen, Fachbegriffe, Eigennamen.
--      Twilio nimmt dafür eine Wortliste entgegen (`hints`); ohne sie rät sie.
--   2. **Variablenextraktion.** Was im Gespräch gesagt wurde, strukturiert und
--      abfragbar, statt als Fließtext im Transkript.
--   3. **Follow-up.** Eine Zusammenfassung dorthin, wo jemand sie sieht, ohne
--      sich in die Konsole einzuloggen.
--
-- Alle drei hängen an Zeilen, die es schon gibt. Keine neue Tabelle: ein
-- Anruf hat genau eine Zeile in `calls`, eine Agenten-Konfiguration genau eine
-- in `agents`, und eine eigene Tabelle hätte nur eine 1:1-Beziehung mit einem
-- zweiten Mandantenfilter erkauft.

-- ---------------------------------------------------------------------------
-- Die Stimm-Konfiguration eines Agenten
-- ---------------------------------------------------------------------------

/**
 * Prüft die Form von `agents.voice_config`.
 *
 * Als Funktion statt als Ausdruck im Check, weil der Test über zwei Arrays
 * iteriert; `immutable` ist hier ehrlich -- die Antwort hängt nur am Eingabewert.
 *
 * Die Grenzen sind keine Willkür:
 *   - 50 Keyterms, weil eine lange Liste die Erkennung nicht schärft, sondern
 *     verwässert: jeder zusätzliche Begriff ist ein weiterer Kandidat, auf den
 *     ein undeutliches Wort gezogen werden kann. Und die Liste fährt bei jedem
 *     einzelnen Zug im TwiML mit.
 *   - 20 Extraktionsfelder, weil sie alle in einem Prompt landen. Wer mehr
 *     braucht, braucht kein Telefonat, sondern ein Formular.
 *   - `name` in snake_case ohne Umlaute: der Wert wird zum JSON-Schlüssel in
 *     `calls.extracted_variables` und damit zu etwas, das jemand in einer
 *     Abfrage tippt.
 */
create or replace function private.voice_config_valid(p_config jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_config is null or p_config = '{}'::jsonb then true
    when jsonb_typeof(p_config) <> 'object' then false
    -- Ein unbekannter Schlüssel ist fast immer ein Tippfehler, und ein
    -- Tippfehler, der still angenommen wird, ist eine Einstellung, die nie
    -- wirkt. Lieber hier scheitern als im Gespräch.
    when exists (
      select 1 from jsonb_object_keys(p_config) as k
      where k not in ('keyterms', 'extract', 'followup')
    ) then false

    when p_config ? 'keyterms' and not (
      jsonb_typeof(p_config -> 'keyterms') = 'array'
      and jsonb_array_length(p_config -> 'keyterms') <= 50
      and not exists (
        select 1 from jsonb_array_elements(p_config -> 'keyterms') as t
        where jsonb_typeof(t) <> 'string'
           or length(t #>> '{}') not between 1 and 60
      )
    ) then false

    when p_config ? 'extract' and not (
      jsonb_typeof(p_config -> 'extract') = 'array'
      and jsonb_array_length(p_config -> 'extract') <= 20
      and not exists (
        select 1 from jsonb_array_elements(p_config -> 'extract') as f
        where jsonb_typeof(f) <> 'object'
           or not (f ? 'name' and f ? 'prompt')
           or (f ->> 'name') !~ '^[a-z][a-z0-9_]{0,48}$'
           or length(f ->> 'prompt') not between 1 and 400
      )
    ) then false

    when p_config ? 'followup' and not (
      jsonb_typeof(p_config -> 'followup') = 'object'
      and (p_config -> 'followup') ->> 'target' = 'email'
      -- Absichtlich grob: eine Adresse, die hier durchkommt, aber nicht
      -- zustellbar ist, lässt den Versand scheitern -- und das ist folgenlos
      -- (siehe `onError` am Aufruf). Eine Adresse, die an einem zu strengen
      -- Muster scheitert, kostet den Nutzer eine Stunde Suche.
      and ((p_config -> 'followup') ->> 'address') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
    ) then false

    else true
  end;
$$;

alter table public.agents
  -- Leer heißt: keine Keyterms, keine Extraktion, kein Follow-up. Jeder Agent,
  -- den es heute gibt, telefoniert damit weiter wie bisher.
  add column voice_config jsonb not null default '{}'::jsonb
    check (private.voice_config_valid(voice_config));

comment on column public.agents.voice_config is
  'Telefon-Feinschliff: {keyterms:[...], extract:[{name,prompt}], followup:{target:"email",address}}. Leer = aus.';

-- ---------------------------------------------------------------------------
-- Was der Anruf hinterlässt
-- ---------------------------------------------------------------------------

alter table public.calls
  -- Die Felder aus `voice_config.extract`, gefüllt nach Gesprächsende.
  -- `{}` heißt "nichts extrahiert" und ist von "noch nicht gelaufen" nicht zu
  -- unterscheiden -- deshalb sagt `wrapup_status` das getrennt.
  add column extracted_variables jsonb not null default '{}'::jsonb
    check (jsonb_typeof(extracted_variables) = 'object'),
  add column summary text check (summary is null or length(summary) <= 4000),
  -- Ohne diese Spalte wäre ein leeres `extracted_variables` doppeldeutig: nicht
  -- gelaufen, nichts gefunden, oder gescheitert. Genau die Sorte Stille, die
  -- check-wiring.mjs sonst als "Spalte ohne Schreiber" meldet.
  add column wrapup_status text not null default 'pending'
    check (wrapup_status in ('pending', 'skipped', 'done', 'failed'));

comment on column public.calls.extracted_variables is
  'Nach Gesprächsende aus dem Transkript gezogen, Schlüssel = agents.voice_config.extract[].name.';
comment on column public.calls.wrapup_status is
  'pending = läuft noch, skipped = nichts zu tun, done = fertig, failed = Nachbereitung gescheitert.';

-- Die Nachbereitung sucht offene Anrufe. Ohne Index wäre das ein Seq-Scan über
-- alle je geführten Gespräche, und zwar bei jedem Auflegen.
create index calls_wrapup_pending_idx on public.calls (organization_id, ended_at)
  where wrapup_status = 'pending';
