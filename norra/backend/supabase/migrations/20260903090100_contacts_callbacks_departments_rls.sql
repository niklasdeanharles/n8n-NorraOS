-- Row level security for the three tables a phone call needs.
--
-- Same split as everywhere else: configuration is admin-only, operational
-- records belong to the whole support team. And as everywhere else, this
-- protects the Next.js path only -- the voice webhooks run with service_role and
-- carry their own enforcement, because they resolve the organization from the
-- dialled number and never take one from the request.

alter table public.contacts enable row level security;
alter table public.callbacks enable row level security;
alter table public.phone_departments enable row level security;

grant select, insert, update, delete
  on public.contacts, public.callbacks, public.phone_departments
  to authenticated, service_role;

-- A contact is what the team knows about a caller. Everyone who answers the
-- phone needs to read it, and to correct a name or add a note after a call --
-- so writing is not reserved to admins here.
create policy contacts_select_same_org on public.contacts
  for select to authenticated
  using (organization_id = private.current_org_id());

create policy contacts_write_same_org on public.contacts
  for all to authenticated
  using (organization_id = private.current_org_id())
  with check (organization_id = private.current_org_id());

-- A callback is a promise to a customer. Whoever is on shift has to be able to
-- see it, take it, and close it.
create policy callbacks_select_same_org on public.callbacks
  for select to authenticated
  using (organization_id = private.current_org_id());

create policy callbacks_write_same_org on public.callbacks
  for all to authenticated
  using (organization_id = private.current_org_id())
  with check (organization_id = private.current_org_id());

-- Departments are configuration, and a wrong number here sends a customer to a
-- stranger. Admins only.
create policy phone_departments_select_same_org on public.phone_departments
  for select to authenticated
  using (organization_id = private.current_org_id());

create policy phone_departments_write_admin on public.phone_departments
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());
