-- Row level security for the telephony tables.
--
-- Same split as the rest of the schema: configuration is admin-only, operational
-- records are readable by the whole support team. As everywhere, this protects
-- the Next.js path; the voice webhooks run with service_role and carry their own
-- enforcement -- they resolve an organization from the dialled number and never
-- take one from the request.

alter table public.phone_numbers enable row level security;
alter table public.calls enable row level security;

grant select, insert, update, delete on public.phone_numbers, public.calls
  to authenticated, service_role;

-- Numbers are configuration: the whole team needs to see which line an agent
-- answers, only admins change it.
create policy phone_numbers_select_same_org on public.phone_numbers
  for select to authenticated
  using (organization_id = private.current_org_id());

create policy phone_numbers_write_admin on public.phone_numbers
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());

-- Calls are a record of what happened, written by the webhooks with
-- service_role. The app reads them; it does not invent them.
create policy calls_select_same_org on public.calls
  for select to authenticated
  using (organization_id = private.current_org_id());
