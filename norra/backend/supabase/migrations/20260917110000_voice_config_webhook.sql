-- Das Ergebnis eines Anrufs dorthin, wo der Kunde arbeitet.
--
-- Die Nachbereitung schreibt bisher in `calls` und schickt auf Wunsch eine
-- Mail. Beides landet bei Norra. Wer das Ergebnis in seinem CRM braucht, muss
-- es abschreiben -- und genau das ist die Arbeit, die ein Telefonassistent
-- abnehmen soll.
--
-- Ein dritter Schlüssel in `voice_config`, keine neue Tabelle und keine neue
-- Spalte: es ist dieselbe Sorte Einstellung wie Keyterms und Follow-up, sie
-- gehört an dieselbe Stelle.

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
      where k not in ('keyterms', 'extract', 'followup', 'webhook')
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
      and ((p_config -> 'followup') ->> 'address') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
    ) then false

    -- Die Zieladresse trägt Gesprächsinhalte eines Anrufers. `https` ist
    -- deshalb keine Empfehlung, sondern Bedingung: über `http` liefe das
    -- Transkript im Klartext durchs Netz.
    when p_config ? 'webhook' and not (
      jsonb_typeof(p_config -> 'webhook') = 'object'
      and ((p_config -> 'webhook') ->> 'url') ~ '^https://[^[:space:]]+$'
      and length((p_config -> 'webhook') ->> 'url') <= 500
      -- Nur `url`. Ein Header oder ein Token gehört nicht in die Datenbank;
      -- wer die Zustellung absichern will, nimmt eine URL mit Einmal-Pfad.
      and not exists (
        select 1 from jsonb_object_keys(p_config -> 'webhook') as k where k <> 'url'
      )
    ) then false

    else true
  end;
$$;

comment on column public.agents.voice_config is
  'Telefon-Feinschliff: {keyterms:[...], extract:[{name,prompt}], followup:{target:"email",address}, webhook:{url}}. Leer = aus.';
