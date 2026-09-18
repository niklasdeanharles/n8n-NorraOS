-- Executable form of the rules behind the four phone tools.
--
-- Run against a scratch database that has the migrations applied:
--   supabase db reset
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/tests/telephony-tools.test.sql
--
-- Every check raises on failure, so a non-zero exit means one of these is
-- broken. The whole thing runs in a transaction and rolls back.

begin;

do $$
declare
  v_ada uuid := 'aa000000-0000-0000-0000-000000000001';
  v_eve uuid := 'ee000000-0000-0000-0000-000000000001';
  v_org_a uuid;
  v_org_b uuid;
  v_contact_a uuid;
  v_contact_again uuid;
  v_count integer;
  v_calls integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_ada, 'ada@phone.test', '{"organization_name":"Phone A","full_name":"Ada"}');
  select organization_id into v_org_a from public.users where id = v_ada;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_eve, 'eve@phone.test', '{"organization_name":"Phone B","full_name":"Eve"}');
  select organization_id into v_org_b from public.users where id = v_eve;

  -- -------------------------------------------------------------------------
  -- touch_contact: the same caller twice is one contact, not two
  -- -------------------------------------------------------------------------
  -- Two lines ringing at once from the same number is not exotic; it is a
  -- redial. Select-then-insert would race into a unique violation here.
  v_contact_a := public.touch_contact(v_org_a, '+4915100000001');
  v_contact_again := public.touch_contact(v_org_a, '+4915100000001');
  if v_contact_a <> v_contact_again then
    raise exception 'the same caller produced two contacts';
  end if;

  select call_count into v_calls from public.contacts where id = v_contact_a;
  if v_calls <> 2 then raise exception 'call_count is %, expected 2', v_calls; end if;

  -- The same person may call two of our customers. Neither may see the other's
  -- note about them.
  perform public.touch_contact(v_org_b, '+4915100000001');
  select count(*) into v_count from public.contacts where e164 = '+4915100000001';
  if v_count <> 2 then
    raise exception 'one number across two tenants produced % rows, expected 2', v_count;
  end if;

  -- -------------------------------------------------------------------------
  -- Departments: the table the transfer resolves against
  -- -------------------------------------------------------------------------
  insert into public.phone_departments (organization_id, name, e164, description)
  values (v_org_a, 'Buchhaltung', '+493011111111', 'Rechnungen, Mahnungen, Zahlungsarten');

  -- The agent picks a department by name, so a name has to mean one thing --
  -- including when someone types it with different case or stray spaces.
  begin
    insert into public.phone_departments (organization_id, name, e164, description)
    values (v_org_a, '  buchhaltung ', '+493022222222', 'Doppelt');
    raise exception 'a duplicate department name was accepted';
  exception when unique_violation then
    null;
  end;

  -- A department the agent may not invent a number for.
  begin
    insert into public.phone_departments (organization_id, name, e164, description)
    values (v_org_a, 'Technik', 'Hotline 0800', 'Technische Fragen');
    raise exception 'a non-E.164 department number was accepted';
  exception when check_violation then
    null;
  end;

  -- -------------------------------------------------------------------------
  -- Callbacks: a promise that has to stay honest
  -- -------------------------------------------------------------------------
  insert into public.callbacks (organization_id, contact_id, e164, reason, preference)
  values (v_org_a, v_contact_a, '+4915100000001', 'Rueckfrage zur Rechnung', 'heute Nachmittag');

  -- A finished callback must say when. Otherwise "erledigt" is a claim nobody
  -- can check.
  begin
    update public.callbacks set status = 'done' where organization_id = v_org_a;
    raise exception 'a callback was closed without a completion time';
  exception when check_violation then
    null;
  end;

  update public.callbacks
  set status = 'done', completed_at = now(), completed_by = v_ada
  where organization_id = v_org_a;

  -- -------------------------------------------------------------------------
  -- RLS: the whole point of the exercise
  -- -------------------------------------------------------------------------
  set local role authenticated;

  perform set_config('request.jwt.claim.sub', v_ada::text, true);
  select count(*) into v_count from public.contacts;
  if v_count <> 1 then
    raise exception 'tenant A sees % contacts, expected only their own', v_count;
  end if;

  -- Eve runs a different company. Ada's caller list is not hers to read, and a
  -- caller's number is exactly the kind of thing that must not leak.
  perform set_config('request.jwt.claim.sub', v_eve::text, true);
  select count(*) into v_count from public.callbacks;
  if v_count <> 0 then raise exception 'tenant B can see % of tenant A callbacks', v_count; end if;

  select count(*) into v_count from public.phone_departments;
  if v_count <> 0 then raise exception 'tenant B can see % of tenant A departments', v_count; end if;

  -- Writing into someone else's tenant must fail even with a valid id in hand.
  begin
    insert into public.phone_departments (organization_id, name, e164, description)
    values (v_org_a, 'Fremd', '+493099999999', 'Untergeschoben');
    raise exception 'a cross-tenant department insert was allowed';
  exception when insufficient_privilege then
    null;
  end;

  -- touch_contact is security definer and bypasses RLS by design. It must not
  -- be reachable from a browser session, or it becomes a way to write into any
  -- tenant.
  begin
    perform public.touch_contact(v_org_a, '+4915100000009');
    raise exception 'touch_contact was callable as authenticated';
  exception when insufficient_privilege then
    null;
  end;

  set local role postgres;

  -- -------------------------------------------------------------------------
  -- Rate limiting: the only guard on the one surface strangers reach
  -- -------------------------------------------------------------------------
  -- Exactness under load is the whole point: read-then-write would let two
  -- requests in the same millisecond both see "2 of 3" and both proceed.
  for i in 1..3 loop
    if not public.take_rate_limit('test:bucket', 3, 60) then
      raise exception 'call % was refused inside the limit', i;
    end if;
  end loop;
  if public.take_rate_limit('test:bucket', 3, 60) then
    raise exception 'the fourth call was allowed past a limit of three';
  end if;

  -- One busy caller must not shut out everyone else.
  if not public.take_rate_limit('test:other', 3, 60) then
    raise exception 'a separate bucket was affected by another one';
  end if;

  -- -------------------------------------------------------------------------
  -- Where an agent may be embedded
  -- -------------------------------------------------------------------------
  -- A path or a wildcard never matches an Origin header, so accepting one
  -- would lock the agent out of its own site while looking configured.
  begin
    insert into public.agents (organization_id, name, slug, allowed_origins)
    values (v_org_a, 'Bad', 'bad', array['https://kunde.de/chat']);
    raise exception 'an origin with a path was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.agents (organization_id, name, slug, allowed_origins)
    values (v_org_a, 'Star', 'star', array['*']);
    raise exception 'a wildcard origin was accepted';
  exception when check_violation then
    null;
  end;

  -- Empty stays legal: every agent that existed before this column keeps
  -- working, and the restriction is opt-in.
  insert into public.agents (organization_id, name, slug)
  values (v_org_a, 'Open', 'open');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_ada::text, true);

  -- take_rate_limit is security definer. Reachable from a browser session it
  -- would become a way to burn any tenant's window.
  begin
    perform public.take_rate_limit('x', 1, 60);
    raise exception 'take_rate_limit was callable as authenticated';
  exception when insufficient_privilege then
    null;
  end;

  -- And the counts themselves are nobody's business.
  begin
    perform count(*) from public.rate_limits;
    raise exception 'rate_limits was readable as authenticated';
  exception when insufficient_privilege then
    null;
  end;

  set local role postgres;
  raise notice 'telephony tool rules hold';
end;
$$;

rollback;
