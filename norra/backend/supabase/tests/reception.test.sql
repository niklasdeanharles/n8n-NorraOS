-- Executable form of the reception guarantees.
--
--   psql "$DB_URL" -f supabase/tests/reception.test.sql
--
-- Every check raises on failure; the whole thing rolls back.
--
-- Drei Zusagen stehen hier, und alle drei betreffen Menschen, die nicht
-- angerufen haben:
--
--   1. **Erreichbarkeit.** Wer im Verzeichnis als durchstellbar steht, hat eine
--      Nummer. Wer Nachrichten annimmt, hat einen Zustellweg. Sonst ist der
--      Eintrag ein Versprechen, das beim ersten Anruf bricht.
--   2. **Mitschnitt nur mit Ansage.** Ein Gespräch ohne Hinweis aufzuzeichnen
--      ist in Deutschland strafbar. Die Datenbank lässt es nicht zu.
--   3. **Mandant.** Eine Nachricht ist das, was ein Anrufer jemandem ausrichten
--      lassen wollte. Sie verlässt ihre Organisation nicht.

begin;

do $$
declare
  v_admin uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_rival uuid := '12121212-1212-1212-1212-121212121212';
  v_org uuid;
  v_rival_org uuid;
  v_agent uuid;
  v_number uuid;
  v_vogel uuid;
  v_message uuid;
  v_count integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'admin@empfang.test', '{"organization_name":"Empfang Test"}');
  select organization_id into v_org from public.users where id = v_admin;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_member, 'member@empfang.test', jsonb_build_object('organization_id', v_org::text));

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_rival, 'admin@empfang-rival.test', '{"organization_name":"Empfang Rival"}');
  select organization_id into v_rival_org from public.users where id = v_rival;

  insert into public.agents (organization_id, name, slug, status, channels)
  values (v_org, 'Empfang', 'empfang', 'live', array['voice']) returning id into v_agent;

  -- ---- Erreichbarkeit ------------------------------------------------------

  -- Durchstellen ohne Nummer ist ein Versprechen, das beim ersten Anruf bricht.
  --
  -- `accepts_messages` steht hier ausdrücklich auf false, obwohl der Default
  -- true wäre: sonst schlüge die Zeile an der *anderen* Regel an
  -- (`staff_members_reachable`, kein Zustellweg) und diese Prüfung bestünde,
  -- ohne je die Regel zu berühren, die sie im Namen trägt. Genau dieser Fehler
  -- steckte in der ersten Fassung und fiel erst bei der Fehlerinjektion auf.
  begin
    insert into public.staff_members (organization_id, name, accepts_transfers, accepts_messages)
    values (v_org, 'Ohne Nummer', true, false);
    raise exception 'jemand ohne Rufnummer wurde als durchstellbar angelegt';
  exception when check_violation then null;
  end;

  -- Eine Nachricht ohne Zustellweg bliebe liegen, und niemand wüsste davon.
  begin
    insert into public.staff_members (organization_id, name, accepts_transfers, accepts_messages)
    values (v_org, 'Ohne alles', false, true);
    raise exception 'jemand ohne Mail und ohne Nummer nimmt Nachrichten an';
  exception when check_violation then null;
  end;

  -- Gegenprobe: mit Nummer geht dieselbe Zeile durch. Ohne sie bewiese die
  -- Prüfung oben nur, dass *irgendetwas* ablehnt.
  insert into public.staff_members (organization_id, name, e164, accepts_transfers, accepts_messages)
  values (v_org, 'Mit Nummer', '+4930111222999', true, false);

  insert into public.staff_members
    (organization_id, name, role, e164, extension, email, note, created_by)
  values (v_org, 'Frau Vogel', 'Großkundenbetreuung', '+4930111222333', '17',
          'vogel@empfang.test', 'Dienstags und donnerstags im Haus.', v_admin)
  returning id into v_vogel;

  -- Eine Durchwahl gibt es im Haus nur einmal. Zwei Menschen unter derselben
  -- Nummer wäre ein Anruf, der beim Falschen landet.
  begin
    insert into public.staff_members (organization_id, name, e164, extension)
    values (v_org, 'Herr Doppelt', '+4930111222444', '17');
    raise exception 'dieselbe Durchwahl wurde zweimal vergeben';
  exception when unique_violation then null;
  end;

  -- In einer anderen Organisation ist dieselbe Durchwahl kein Problem.
  insert into public.staff_members (organization_id, name, e164, extension)
  values (v_rival_org, 'Fremde Kollegin', '+4930999888777', '17');

  -- ---- Mitschnitt nur mit Ansage -------------------------------------------

  insert into public.phone_numbers (organization_id, e164, agent_id, status)
  values (v_org, '+4930555444333', v_agent, 'active') returning id into v_number;

  -- Der eigentliche Punkt: aufzeichnen ohne Hinweis geht nicht. Nicht weil die
  -- Route es verhindert -- eine Route kann man umgehen -- sondern weil die
  -- Zeile es nicht zulässt.
  begin
    update public.phone_numbers set recording_enabled = true where id = v_number;
    raise exception 'ein Mitschnitt wurde ohne Ansage erlaubt';
  exception when check_violation then null;
  end;

  -- Eine Ansage, die zu kurz ist, um irgendetwas zu erklären, ist keine.
  begin
    update public.phone_numbers set recording_notice = 'Hallo' where id = v_number;
    raise exception 'eine Fünf-Zeichen-Ansage wurde angenommen';
  exception when check_violation then null;
  end;

  update public.phone_numbers
  set recording_notice = 'Dieses Gespräch wird zur Qualitätssicherung aufgezeichnet.',
      recording_enabled = true
  where id = v_number;

  -- Und zurück: die Ansage zu entfernen, während aufgezeichnet wird, ebenfalls
  -- nicht. Sonst wäre die Regel nur beim Einschalten wirksam.
  begin
    update public.phone_numbers set recording_notice = null where id = v_number;
    raise exception 'die Ansage wurde bei laufendem Mitschnitt entfernt';
  exception when check_violation then null;
  end;

  -- ---- Nachrichten ---------------------------------------------------------

  begin
    insert into public.messages_for_staff (organization_id, staff_member_id, body)
    values (v_org, v_vogel, '   ');
    raise exception 'eine leere Nachricht wurde angenommen';
  exception when check_violation then null;
  end;

  insert into public.messages_for_staff
    (organization_id, staff_member_id, caller_name, caller_e164, body, urgency)
  values (v_org, v_vogel, 'A. Beispiel', '+4915112345678',
          'Der Termin am Freitag fällt aus.', 'dringend')
  returning id into v_message;

  -- `erledigt` ohne Zeitpunkt wäre eine Nachricht, von der niemand sagen kann,
  -- wann sie abgehakt wurde.
  begin
    update public.messages_for_staff set status = 'erledigt' where id = v_message;
    raise exception 'eine Nachricht wurde ohne Zeitpunkt als erledigt markiert';
  exception when check_violation then null;
  end;

  update public.messages_for_staff
  set status = 'erledigt', handled_at = now(), handled_by = v_member
  where id = v_message;

  -- ---- Rolle ---------------------------------------------------------------

  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;

  -- Das Verzeichnis ist das Telefonbuch: jeder im Haus liest es.
  select count(*) into v_count from public.staff_members;
  if v_count <> 2 then
    raise exception 'ein Mitglied sieht % Einträge im Verzeichnis, erwartet 2', v_count;
  end if;

  -- Wer hier einträgt, entscheidet, wohin Anrufe gehen.
  begin
    insert into public.staff_members (organization_id, name, e164)
    values (v_org, 'Von einem Mitglied', '+4930111000999');
    raise exception 'ein Mitglied ohne Admin-Rolle hat jemanden ins Verzeichnis gesetzt';
  exception when insufficient_privilege then null;
  end;

  -- Nachrichten dagegen bearbeitet jeder, der am Telefon sitzt -- dafür sind sie da.
  select count(*) into v_count from public.messages_for_staff;
  if v_count <> 1 then
    raise exception 'ein Mitglied sieht % Nachrichten, erwartet 1', v_count;
  end if;

  reset role;

  -- ---- Mandant -------------------------------------------------------------

  perform set_config('request.jwt.claim.sub', v_rival::text, true);
  set local role authenticated;

  -- Die eigentliche Zusage: was ein Anrufer jemandem ausrichten lassen wollte,
  -- verlässt seine Organisation nicht.
  select count(*) into v_count from public.messages_for_staff;
  if v_count <> 0 then
    raise exception 'ein fremder Admin sieht % Nachrichten, erwartet 0', v_count;
  end if;

  select count(*) into v_count from public.staff_members where organization_id = v_org;
  if v_count <> 0 then
    raise exception 'ein fremder Admin sieht % fremde Verzeichniseinträge, erwartet 0', v_count;
  end if;

  reset role;

  raise notice 'reception: all checks passed';
end $$;

rollback;
