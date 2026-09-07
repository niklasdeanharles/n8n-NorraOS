-- Executable form of the telephony guarantees.
--
--   psql "$DB_URL" -f supabase/tests/phone.test.sql
--
-- Every check raises on failure; the whole thing rolls back.

begin;

do $$
declare
  v_admin uuid := '66666666-6666-6666-6666-666666666666';
  v_member uuid := '77777777-7777-7777-7777-777777777777';
  v_other_admin uuid := '88888888-8888-8888-8888-888888888888';
  v_org uuid;
  v_other_org uuid;
  v_agent uuid;
  v_number uuid;
  v_conv uuid;
  v_count integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'admin@phone.test', '{"organization_name":"Phone Test"}');
  select organization_id into v_org from public.users where id = v_admin;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_member, 'member@phone.test', jsonb_build_object('organization_id', v_org::text));

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_other_admin, 'admin@rival.test', '{"organization_name":"Rival Telco"}');
  select organization_id into v_other_org from public.users where id = v_other_admin;

  insert into public.agents (organization_id, name, slug, status)
  values (v_org, 'Phone Bot', 'phone-bot', 'live') returning id into v_agent;

  -- A number must look like a number.
  begin
    insert into public.phone_numbers (organization_id, e164) values (v_org, '030 1234567');
    raise exception 'a non-E.164 number was accepted';
  exception when check_violation then null;
  end;

  insert into public.phone_numbers (organization_id, e164, label)
  values (v_org, '+4930123456789', 'Hauptnummer') returning id into v_number;

  -- Going live without someone to answer is the classic half-configured state.
  begin
    update public.phone_numbers set status = 'active' where id = v_number;
    raise exception 'a number went live without an agent';
  exception when check_violation then null;
  end;

  update public.phone_numbers set agent_id = v_agent, status = 'active' where id = v_number;

  -- Falling back to a transfer requires a destination.
  begin
    update public.phone_numbers set after_hours = 'transfer' where id = v_number;
    raise exception 'a transfer fallback was set without a target number';
  exception when check_violation then null;
  end;

  update public.phone_numbers
  set after_hours = 'transfer', transfer_number = '+4930999888777'
  where id = v_number;

  -- THE tenancy guarantee for telephony: an inbound call carries only the
  -- dialled number, so a second organization claiming it would make routing
  -- ambiguous across tenants.
  begin
    insert into public.phone_numbers (organization_id, e164)
    values (v_other_org, '+4930123456789');
    raise exception 'two organizations claimed the same number';
  exception when unique_violation then null;
  end;

  insert into public.conversations (organization_id, agent_id, channel, external_id)
  values (v_org, v_agent, 'voice', 'CA-test-0001') returning id into v_conv;

  insert into public.calls (organization_id, phone_number_id, conversation_id, agent_id,
                            provider_call_id, from_e164, to_e164)
  values (v_org, v_number, v_conv, v_agent, 'CA-test-0001', '+4917612345678', '+4930123456789');

  -- Every webhook for a call arrives more than once in practice; the second one
  -- must land on the same row rather than create a duplicate.
  begin
    insert into public.calls (organization_id, provider_call_id) values (v_org, 'CA-test-0001');
    raise exception 'a duplicate call record was created';
  exception when unique_violation then null;
  end;

  -- ---- as a plain member of the organization -----------------------------
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_member::text, true);

  select count(*) into v_count from public.phone_numbers;
  if v_count <> 1 then
    raise exception 'a member sees % numbers, expected 1', v_count;
  end if;

  select count(*) into v_count from public.calls;
  if v_count <> 1 then
    raise exception 'a member sees % calls, expected 1', v_count;
  end if;

  -- Configuration stays with admins: a member must not repoint a live line.
  begin
    update public.phone_numbers set agent_id = null, status = 'paused' where id = v_number;
    if found then
      raise exception 'a member reconfigured a phone number';
    end if;
  exception when insufficient_privilege then null;
  end;

  -- Calls are a record of what happened, not something the app invents.
  begin
    insert into public.calls (organization_id, provider_call_id) values (v_org, 'CA-forged');
    raise exception 'a member forged a call record';
  exception when insufficient_privilege then null;
  end;

  -- ---- as an admin of the other organization -----------------------------
  perform set_config('request.jwt.claim.sub', v_other_admin::text, true);

  select count(*) into v_count from public.phone_numbers;
  if v_count <> 0 then
    raise exception 'a rival admin sees % numbers, expected 0', v_count;
  end if;

  select count(*) into v_count from public.calls;
  if v_count <> 0 then
    raise exception 'a rival admin sees % calls, expected 0', v_count;
  end if;

  reset role;

  raise notice 'phone: all checks passed';
end $$;

rollback;
