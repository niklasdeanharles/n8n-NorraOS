-- RLS for the governance and simulation tables.

alter table public.approvals enable row level security;
alter table public.audit_log enable row level security;
alter table public.agent_test_cases enable row level security;
alter table public.agent_test_runs enable row level security;

grant select, insert, update, delete on
  public.approvals,
  public.agent_test_cases,
  public.agent_test_runs
to authenticated, service_role;

-- The audit log is append-only for everyone: no update, no delete granted, so
-- a trail cannot be quietly rewritten by the people it records.
grant select, insert on public.audit_log to authenticated, service_role;

-- Approvals: everyone in the org sees the queue; only admins decide.
create policy approvals_select_same_org on public.approvals
  for select to authenticated
  using (organization_id = private.current_org_id());

create policy approvals_decide_admin on public.approvals
  for update to authenticated
  using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id());

-- Audit log: readable org-wide, writable but never editable.
create policy audit_log_select_same_org on public.audit_log
  for select to authenticated
  using (organization_id = private.current_org_id());

create policy audit_log_insert_same_org on public.audit_log
  for insert to authenticated
  with check (organization_id = private.current_org_id());

-- Test cases: readable org-wide, curated by admins.
create policy test_cases_select_same_org on public.agent_test_cases
  for select to authenticated
  using (organization_id = private.current_org_id());

create policy test_cases_write_admin on public.agent_test_cases
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());

-- Runs are results, not inputs: readable, written by the runner via service_role.
create policy test_runs_select_same_org on public.agent_test_runs
  for select to authenticated
  using (organization_id = private.current_org_id());

-- Realtime so the approval queue and a running simulation update themselves.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.approvals;
    alter publication supabase_realtime add table public.agent_test_runs;
  end if;
end;
$$;

alter table public.approvals replica identity full;
