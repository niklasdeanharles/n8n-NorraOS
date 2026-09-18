-- Executable form of the language guarantees.
--
--   psql "$DB_URL" -f supabase/tests/languages.test.sql
--
-- Every check raises on failure; the whole thing rolls back.
--
-- Drei Zusagen:
--
--   1. **Form.** Ein Sprachcode geht direkt in ein TwiML-Attribut. Was dort
--      nicht die Form `de-DE` hat, ist beim Anbieter ein Fehler.
--   2. **Ganz oder gar nicht.** Eine Stimme ohne Sprache wäre eine halbe
--      Umschaltung: gesprochen würde anders, erkannt weiterhin wie vorher.
--   3. **Eine Sprache je Leitung einmal.** Zwei Zeilen für `en-US` wären zwei
--      Stimmen für denselben Satz, und die Sortierung entschiede.

begin;

do $$
declare
  v_admin uuid := 'dddddddd-2222-4222-8222-dddddddddddd';
  v_member uuid := 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee';
  v_org uuid;
  v_agent uuid;
  v_number uuid;
  v_conversation uuid;
  v_call uuid;
  v_count integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'admin@sprachen.test', '{"organization_name":"Sprachen Test"}');
  select organization_id into v_org from public.users where id = v_admin;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_member, 'member@sprachen.test', jsonb_build_object('organization_id', v_org::text));

  insert into public.agents (organization_id, name, slug, status, channels)
  values (v_org, 'Empfang', 'empfang', 'live', array['voice']) returning id into v_agent;

  insert into public.phone_numbers (organization_id, e164, agent_id, status)
  values (v_org, '+4930777111222', v_agent, 'active') returning id into v_number;

  -- ---- Form ----------------------------------------------------------------

  begin
    insert into public.phone_languages (organization_id, phone_number_id, code, voice)
    values (v_org, v_number, 'englisch', 'Polly.Joanna-Neural');
    raise exception 'ein Sprachcode ohne Form wurde angenommen';
  exception when check_violation then null;
  end;

  -- Auch die falsche Gross-/Kleinschreibung: Twilio liest `de-de` nicht.
  begin
    insert into public.phone_languages (organization_id, phone_number_id, code, voice)
    values (v_org, v_number, 'en-us', 'Polly.Joanna-Neural');
    raise exception 'ein kleingeschriebenes Land wurde angenommen';
  exception when check_violation then null;
  end;

  -- Gegenprobe: richtig geschrieben geht dieselbe Zeile durch.
  insert into public.phone_languages (organization_id, phone_number_id, code, voice, created_by)
  values (v_org, v_number, 'en-US', 'Polly.Joanna-Neural', v_admin);

  -- ---- Eine Sprache je Leitung einmal --------------------------------------

  begin
    insert into public.phone_languages (organization_id, phone_number_id, code, voice)
    values (v_org, v_number, 'en-US', 'alice');
    raise exception 'dieselbe Sprache wurde zweimal an dieselbe Leitung gehaengt';
  exception when unique_violation then null;
  end;

  -- ---- Ganz oder gar nicht -------------------------------------------------

  insert into public.conversations (organization_id, agent_id, channel, external_id)
  values (v_org, v_agent, 'voice', 'CA-sprachen') returning id into v_conversation;

  insert into public.calls (organization_id, phone_number_id, conversation_id, agent_id,
                            provider_call_id, to_e164, status)
  values (v_org, v_number, v_conversation, v_agent, 'CA-sprachen', '+4930777111222', 'in_progress')
  returning id into v_call;

  begin
    update public.calls set voice = 'Polly.Joanna-Neural' where id = v_call;
    raise exception 'eine Stimme ohne Sprache wurde angenommen';
  exception when check_violation then null;
  end;

  begin
    update public.calls set language = 'en-US' where id = v_call;
    raise exception 'eine Sprache ohne Stimme wurde angenommen';
  exception when check_violation then null;
  end;

  -- Gegenprobe: beide zusammen gehen durch.
  update public.calls set language = 'en-US', voice = 'Polly.Joanna-Neural' where id = v_call;

  -- Und zurück auf die Vorgabe der Leitung: beide zusammen auf null.
  update public.calls set language = null, voice = null where id = v_call;

  -- ---- Wer eintragen darf --------------------------------------------------

  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;

  select count(*) into v_count from public.phone_languages;
  if v_count <> 1 then
    raise exception 'ein Mitglied sieht % Sprachen, erwartet 1', v_count;
  end if;

  begin
    insert into public.phone_languages (organization_id, phone_number_id, code, voice)
    values (v_org, v_number, 'fr-FR', 'alice');
    raise exception 'ein Mitglied hat eine Sprache freigeschaltet';
  exception when insufficient_privilege then null;
  end;

  reset role;

  raise notice 'languages: all checks passed';
end $$;

rollback;
