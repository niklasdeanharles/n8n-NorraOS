-- Executable form of the governance guarantees.
--
--   psql "$DB_URL" -f supabase/tests/governance.test.sql
--
-- Every check raises on failure; the whole thing rolls back.

begin;

do $$
declare
  v_admin uuid := '44444444-4444-4444-4444-444444444444';
  v_agent_user uuid := '55555555-5555-5555-5555-555555555555';
  v_org uuid;
  v_agent uuid;
  v_conv uuid;
  v_approval uuid;
  v_count integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'admin@gov.test', '{"organization_name":"Gov Test"}');
  select organization_id into v_org from public.users where id = v_admin;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_agent_user, 'agent@gov.test', jsonb_build_object('organization_id', v_org::text));

  insert into public.agents (organization_id, name, slug, status)
  values (v_org, 'Gov Bot', 'gov-bot', 'live') returning id into v_agent;
  insert into public.conversations (organization_id, agent_id, channel)
  values (v_org, v_agent, 'web') returning id into v_conv;

  -- A critical action parks here instead of executing.
  insert into public.approvals (organization_id, conversation_id, agent_id, tool_name, summary, amount, currency)
  values (v_org, v_conv, v_agent, 'refund', 'Rueckerstattung 89,90 EUR fuer Vorgang A-1233', 89.90, 'EUR')
  returning id into v_approval;

  -- A decision must name its decider. Approving without one is a broken trail.
  begin
    update public.approvals set status = 'approved' where id = v_approval;
    raise exception 'an approval was recorded without a decider';
  exception when check_violation then null;
  end;

  update public.approvals
  set status = 'approved', decided_by = v_admin, decided_at = now(), decision_note = 'geprueft'
  where id = v_approval;

  -- Test cases and their runs.
  declare v_case uuid;
  begin
    insert into public.agent_test_cases (organization_id, agent_id, name, input, expect_contains, expect_absent)
    values (v_org, v_agent, 'Erstattung nie zusagen', 'Ich will mein Geld zurueck',
            array['pruef'], array['wurde erstattet'])
    returning id into v_case;

    insert into public.agent_test_runs (organization_id, agent_id, test_case_id, status, output, failures)
    values (v_org, v_agent, v_case, 'failed', 'Der Betrag wurde erstattet.', array['expect_absent: wurde erstattet']);

    select count(*) into v_count from public.agent_test_runs where test_case_id = v_case and status = 'failed';
    if v_count <> 1 then raise exception 'test run was not recorded'; end if;
  end;

  -- Now as a signed-in user, where RLS applies.
  set local role authenticated;

  -- A plain agent may see the queue but must not decide.
  perform set_config('request.jwt.claim.sub', v_agent_user::text, true);
  select count(*) into v_count from public.approvals;
  if v_count <> 1 then raise exception 'a member cannot see the approval queue'; end if;

  update public.approvals set status = 'rejected', decided_by = v_agent_user, decided_at = now();
  if found then raise exception 'a non-admin decided an approval'; end if;

  -- The audit log is append-only: writing is fine, rewriting is not.
  insert into public.audit_log (organization_id, actor_id, actor_label, action, entity_type, entity_id, changes)
  values (v_org, v_agent_user, 'agent@gov.test', 'update', 'agent', v_agent, '{"model":"changed"}'::jsonb);

  begin
    update public.audit_log set changes = '{}'::jsonb where organization_id = v_org;
    raise exception 'an audit entry was rewritten';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.audit_log where organization_id = v_org;
    raise exception 'an audit entry was deleted';
  exception when insufficient_privilege then null;
  end;

  -- Test cases stay admin-curated.
  begin
    insert into public.agent_test_cases (organization_id, agent_id, name, input)
    values (v_org, v_agent, 'Von einem Mitglied', 'darf nicht');
    raise exception 'a non-admin created a test case';
  exception when insufficient_privilege then null;
  end;

  reset role;

  raise notice 'governance: all checks passed';
end $$;

rollback;
