-- Executable form of the closure-day guarantees.
--
--   psql "$DB_URL" -f supabase/tests/closures.test.sql
--
-- Every check raises on failure; the whole thing rolls back.
--
-- Drei Zusagen:
--
--   1. **Ein Bereich hat eine Richtung.** Ein Schließtag, der vor seinem Anfang
--      endet, schließt nie — sähe im Formular aber aus wie einer, der das ganze
--      Jahr schließt.
--   2. **Nur Admins tragen ein.** Ein Schließtag schaltet eine Leitung ab. Wer
--      am Telefon sitzt, darf ihn sehen, nicht setzen.
--   3. **Mandant.** Die Betriebsferien eines Kunden gehen keinen anderen an.

begin;

do $$
declare
  v_admin uuid := 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  v_member uuid := 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
  v_rival uuid := 'cccccccc-1111-4111-8111-cccccccccccc';
  v_org uuid;
  v_rival_org uuid;
  v_agent uuid;
  v_number uuid;
  v_count integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'admin@schliess.test', '{"organization_name":"Schliesstag Test"}');
  select organization_id into v_org from public.users where id = v_admin;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_member, 'member@schliess.test', jsonb_build_object('organization_id', v_org::text));

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_rival, 'admin@schliess-rival.test', '{"organization_name":"Schliesstag Rival"}');
  select organization_id into v_rival_org from public.users where id = v_rival;

  insert into public.agents (organization_id, name, slug, status, channels)
  values (v_org, 'Empfang', 'empfang', 'live', array['voice']) returning id into v_agent;

  insert into public.phone_numbers (organization_id, e164, agent_id, status)
  values (v_org, '+4930555111222', v_agent, 'active') returning id into v_number;

  -- ---- Richtung ------------------------------------------------------------

  begin
    insert into public.closure_days (organization_id, starts_on, ends_on, label)
    values (v_org, date '2026-12-27', date '2026-12-24', 'Verdreht');
    raise exception 'ein Schliesstag endet vor seinem Anfang';
  exception when check_violation then null;
  end;

  -- Gegenprobe: derselbe Bereich richtig herum geht durch. Ohne sie bewiese die
  -- Prüfung oben nur, dass irgendetwas ablehnt.
  insert into public.closure_days (organization_id, starts_on, ends_on, label, message, created_by)
  values (v_org, date '2026-12-24', date '2027-01-06',
          'Betriebsferien', 'Wir haben Betriebsferien bis zum sechsten Januar.', v_admin);

  -- Ein einzelner Tag ist derselbe Bereich mit gleichem Anfang und Ende.
  insert into public.closure_days (organization_id, phone_number_id, starts_on, ends_on, label, created_by)
  values (v_org, v_number, date '2026-10-03', date '2026-10-03', 'Tag der Deutschen Einheit', v_admin);

  -- Eine Ansage, die aus zwei Zeichen besteht, ist keine.
  begin
    insert into public.closure_days (organization_id, starts_on, ends_on, label, message)
    values (v_org, date '2026-05-01', date '2026-05-01', 'Erster Mai', 'zu');
    raise exception 'eine zweistellige Ansage wurde angenommen';
  exception when check_violation then null;
  end;

  -- ---- Wer eintragen darf --------------------------------------------------

  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;

  -- Sehen ja: wer am Telefon sitzt, muss wissen, wann zu ist.
  select count(*) into v_count from public.closure_days;
  if v_count <> 2 then
    raise exception 'ein Mitglied sieht % Schliesstage, erwartet 2', v_count;
  end if;

  -- Setzen nein.
  begin
    insert into public.closure_days (organization_id, starts_on, ends_on, label)
    values (v_org, date '2026-08-01', date '2026-08-14', 'Von einem Mitglied');
    raise exception 'ein Mitglied hat eine Leitung abgeschaltet';
  exception when insufficient_privilege then null;
  end;

  reset role;

  -- ---- Mandant -------------------------------------------------------------

  perform set_config('request.jwt.claim.sub', v_rival::text, true);
  set local role authenticated;

  select count(*) into v_count from public.closure_days;
  if v_count <> 0 then
    raise exception 'ein fremder Admin sieht % fremde Schliesstage, erwartet 0', v_count;
  end if;

  reset role;

  raise notice 'closures: all checks passed';
end $$;

rollback;
