-- Executable form of the voice-config and wrap-up guarantees.
--
--   psql "$DB_URL" -f supabase/tests/voice-config.test.sql
--
-- Every check raises on failure; the whole thing rolls back.
--
-- Zwei Sorten Zusage stehen hier. Die erste ist Form: eine Stimm-Konfiguration,
-- die der Check durchlaesst, muss auch benutzbar sein -- ein Keyterm, das
-- niemand aussprechen kann, oder ein Variablenname, den niemand abfragen kann,
-- ist keine Konfiguration, sondern ein spaeterer Fehlerbericht.
--
-- Die zweite ist Vertraulichkeit, und sie ist die wichtigere. In
-- `calls.extracted_variables` steht, was ein Anrufer am Telefon gesagt hat --
-- Bestellnummern, Namen, Anliegen. Das ist die dichteste personenbezogene
-- Ablage, die Norra hat. Sie faellt unter dieselbe Mandantentrennung wie alles
-- andere, und weil "faellt darunter" eine Behauptung ist, steht sie hier als
-- Pruefung.

begin;

do $$
declare
  v_admin uuid := '99999999-9999-9999-9999-999999999999';
  v_rival uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_org uuid;
  v_rival_org uuid;
  v_agent uuid;
  v_number uuid;
  v_call uuid;
  v_count integer;
  v_text text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'admin@voice.test', '{"organization_name":"Voice Test"}');
  select organization_id into v_org from public.users where id = v_admin;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_rival, 'admin@voice-rival.test', '{"organization_name":"Voice Rival"}');
  select organization_id into v_rival_org from public.users where id = v_rival;

  insert into public.agents (organization_id, name, slug, status)
  values (v_org, 'Voice Bot', 'voice-bot', 'live') returning id into v_agent;

  -- ---- Form der Stimm-Konfiguration --------------------------------------

  -- Ein Agent ohne Stimm-Konfiguration telefoniert wie bisher. Das ist die
  -- Bedingung dafuer, dass diese Migration keinen bestehenden Agenten anfasst.
  select voice_config into v_text from public.agents where id = v_agent;
  if v_text <> '{}' then
    raise exception 'ein neuer Agent startet nicht mit leerer voice_config, sondern mit %', v_text;
  end if;

  -- Ein vertippter Schlüssel wird nicht stillschweigend angenommen. Sonst
  -- stuende eine Einstellung in der Datenbank, die nie wirkt, und niemand
  -- wuesste warum der Agent sich weiter verhoert.
  begin
    update public.agents set voice_config = '{"keytrems":["Rechnungsnummer"]}' where id = v_agent;
    raise exception 'ein unbekannter Schluessel in voice_config wurde angenommen';
  exception when check_violation then null;
  end;

  -- Ein Variablenname wird zum JSON-Schluessel in extracted_variables und damit
  -- zu etwas, das jemand in einer Abfrage tippt. Umlaute und CamelCase haetten
  -- dort nichts zu suchen.
  begin
    update public.agents set voice_config = '{"extract":[{"name":"groesse Ä","prompt":"x"}]}' where id = v_agent;
    raise exception 'ein Variablenname ausserhalb von snake_case wurde angenommen';
  exception when check_violation then null;
  end;

  -- Ein Extraktionsfeld ohne Anweisung ist ein Feld, das das Modell raten muss.
  begin
    update public.agents set voice_config = '{"extract":[{"name":"order_id"}]}' where id = v_agent;
    raise exception 'ein Extraktionsfeld ohne prompt wurde angenommen';
  exception when check_violation then null;
  end;

  -- Ein Follow-up ohne zustellbare Adresse ist ein Follow-up, das niemand
  -- bekommt -- und das faellt erst auf, wenn jemand es vermisst.
  begin
    update public.agents set voice_config = '{"followup":{"target":"email","address":"support"}}' where id = v_agent;
    raise exception 'eine Follow-up-Adresse ohne @ wurde angenommen';
  exception when check_violation then null;
  end;

  -- Umlaute in Keyterms sind ausdruecklich erwuenscht: genau die Woerter, an
  -- denen die Spracherkennung scheitert, tragen sie.
  update public.agents
  set voice_config = jsonb_build_object(
        'keyterms', jsonb_build_array('Rechnungsnummer', 'Kündigung', 'Größe'),
        'extract', jsonb_build_array(
          jsonb_build_object('name', 'order_id', 'prompt', 'Die Bestellnummer, falls genannt.')
        ),
        'followup', jsonb_build_object('target', 'email', 'address', 'ops@voice.test')
      )
  where id = v_agent;

  -- ---- Lebenslauf der Nachbereitung --------------------------------------

  insert into public.phone_numbers (organization_id, e164, agent_id, status)
  values (v_org, '+4930999888777', v_agent, 'active') returning id into v_number;

  insert into public.calls (organization_id, phone_number_id, agent_id, provider_call_id, from_e164)
  values (v_org, v_number, v_agent, 'CA-voice-1', '+4915112345678') returning id into v_call;

  -- Ein frischer Anruf steht auf pending. Ohne diesen Startwert waere ein leeres
  -- extracted_variables doppeldeutig: nicht gelaufen oder nichts gefunden.
  select wrapup_status into v_text from public.calls where id = v_call;
  if v_text <> 'pending' then
    raise exception 'ein neuer Anruf startet mit wrapup_status %, erwartet pending', v_text;
  end if;

  -- Ein erfundener Zustand wuerde die Unterscheidung wieder aufweichen.
  begin
    update public.calls set wrapup_status = 'irgendwas' where id = v_call;
    raise exception 'ein unbekannter wrapup_status wurde angenommen';
  exception when check_violation then null;
  end;

  -- extracted_variables ist ein Objekt, kein Array und kein Freitext -- sonst
  -- traegt der Schluessel nicht mehr den Variablennamen.
  begin
    update public.calls set extracted_variables = '["order_id"]' where id = v_call;
    raise exception 'extracted_variables nahm ein Array an';
  exception when check_violation then null;
  end;

  update public.calls
  set extracted_variables = '{"order_id":"BX-4471"}',
      summary = 'Anrufer fragte nach dem Stand von BX-4471. Auskunft erteilt.',
      wrapup_status = 'done'
  where id = v_call;

  -- ---- Vertraulichkeit ----------------------------------------------------

  -- Der Admin der eigenen Organisation sieht, was gesagt wurde.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  select count(*) into v_count
  from public.calls where extracted_variables ? 'order_id';
  if v_count <> 1 then
    raise exception 'der eigene Admin sieht % extrahierte Anrufe, erwartet 1', v_count;
  end if;

  reset role;

  -- Der Admin einer fremden Organisation sieht nichts davon. Das ist die
  -- eigentliche Zusage: eine Bestellnummer, die ein Kunde am Telefon genannt
  -- hat, verlaesst ihren Mandanten nicht.
  perform set_config('request.jwt.claim.sub', v_rival::text, true);
  set local role authenticated;

  select count(*) into v_count from public.calls;
  if v_count <> 0 then
    raise exception 'ein fremder Admin sieht % Anrufe, erwartet 0', v_count;
  end if;

  select count(*) into v_count from public.agents where voice_config <> '{}';
  if v_count <> 0 then
    raise exception 'ein fremder Admin sieht % Stimm-Konfigurationen, erwartet 0', v_count;
  end if;

  reset role;

  raise notice 'voice-config: all checks passed';
end $$;

rollback;
