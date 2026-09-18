-- Executable form of the voicemail guarantees.
--
--   psql "$DB_URL" -f supabase/tests/voicemail-transcript.test.sql
--
-- Every check raises on failure; the whole thing rolls back.
--
-- Zwei Zusagen:
--
--   1. **Leer ist nicht dasselbe wie nichts.** `null` heißt „noch nicht
--      verschriftet", der leere String hieße „verschriftet, und es kam nichts
--      dabei heraus" — und die Oberfläche zeigte eine Sprachnachricht ohne
--      Inhalt statt des Links zur Aufnahme.
--   2. **Die Abschrift gehört dem Mandanten.** Sie hängt an `calls` und damit
--      an derselben RLS wie der Anruf: ein fremder Admin liest sie nicht.

begin;

do $$
declare
  v_admin uuid := 'dddddddd-3333-4333-8333-dddddddddddd';
  v_other uuid := 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee';
  v_org uuid;
  v_agent uuid;
  v_conversation uuid;
  v_call uuid;
  v_count integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'admin@mailbox.test', '{"organization_name":"Mailbox Test"}');
  select organization_id into v_org from public.users where id = v_admin;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_other, 'admin@fremd-mailbox.test', '{"organization_name":"Fremd Mailbox"}');

  insert into public.agents (organization_id, name, slug, status, channels)
  values (v_org, 'Empfang', 'empfang', 'live', array['voice']) returning id into v_agent;

  insert into public.conversations (organization_id, agent_id, channel, status)
  values (v_org, v_agent, 'voice', 'closed') returning id into v_conversation;

  insert into public.calls (organization_id, conversation_id, agent_id, direction, status, provider_call_id)
  values (v_org, v_conversation, v_agent, 'inbound', 'voicemail', 'CA-mailbox-1')
  returning id into v_call;

  -- 1a) Noch nicht verschriftet ist der Normalfall und muss erlaubt sein.
  if (select voicemail_transcript from public.calls where id = v_call) is not null then
    raise exception 'FAIL: voicemail_transcript startet nicht als null';
  end if;

  -- 1b) Eine echte Abschrift geht durch.
  update public.calls
     set voicemail_transcript = 'Guten Tag, hier ist Frau Berger. Bitte rufen Sie mich zurueck.'
   where id = v_call;

  -- 1c) Der leere String und reiner Weissraum nicht.
  begin
    update public.calls set voicemail_transcript = '' where id = v_call;
    raise exception 'FAIL: der leere String wurde als Abschrift angenommen';
  exception when check_violation then null;
  end;

  begin
    update public.calls set voicemail_transcript = '   ' where id = v_call;
    raise exception 'FAIL: reiner Weissraum wurde als Abschrift angenommen';
  exception when check_violation then null;
  end;

  -- 1d) Und ein Modell, das statt einer Abschrift seitenweise redet, auch nicht.
  begin
    update public.calls set voicemail_transcript = repeat('a', 20001) where id = v_call;
    raise exception 'FAIL: eine Abschrift ueber der Obergrenze wurde angenommen';
  exception when check_violation then null;
  end;

  -- 2) Ein fremder Admin sieht die Abschrift nicht -- dieselbe RLS wie der Anruf.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.calls where id = v_call;
  if v_count <> 0 then
    raise exception 'FAIL: ein fremder Admin sieht den Anruf samt Abschrift';
  end if;
  perform set_config('role', 'postgres', true);

  raise notice 'OK: voicemail-transcript guarantees hold';
end $$;

rollback;
