-- Row level security for every table.
--
-- Scope: this protects the Next.js path, where requests carry a user's JWT and
-- run as `authenticated`. It does NOT protect the n8n path -- n8n connects with
-- the service_role key, which is BYPASSRLS. Tenant isolation there rests on
-- public.match_kb_chunks enforcing organization_id server-side (next migration)
-- and on the workflows passing the right ids. Any new RPC that n8n calls must
-- carry the same enforcement.

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.agents enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.knowledge_base_documents enable row level security;
alter table public.knowledge_base_chunks enable row level security;
alter table public.tickets enable row level security;
alter table public.tool_calls_log enable row level security;

grant usage on schema public, extensions to authenticated, service_role;

grant select, insert, update, delete on
  public.organizations,
  public.users,
  public.agents,
  public.conversations,
  public.messages,
  public.knowledge_base_documents,
  public.knowledge_base_chunks,
  public.tickets,
  public.tool_calls_log
to authenticated, service_role;

-- service_role is BYPASSRLS, so these grants are what n8n actually runs on.
-- Supabase also grants them implicitly at project bootstrap; stating them here
-- keeps the schema reproducible from migrations alone.
grant usage, select on all sequences in schema public to service_role;

-- organizations: members read their own; only admins may rename it.
create policy organizations_select_own on public.organizations
  for select to authenticated
  using (id = private.current_org_id());

create policy organizations_update_admin on public.organizations
  for update to authenticated
  using (id = private.current_org_id() and private.is_org_admin())
  with check (id = private.current_org_id());

-- users: everyone sees their colleagues; you edit yourself, admins edit anyone
-- in the org. Nobody inserts directly -- the auth trigger owns that path -- and
-- nobody deletes here, since deleting auth.users cascades.
create policy users_select_same_org on public.users
  for select to authenticated
  using (organization_id = private.current_org_id());

create policy users_update_self_or_admin on public.users
  for update to authenticated
  using (
    organization_id = private.current_org_id()
    and (id = (select auth.uid()) or private.is_org_admin())
  )
  with check (organization_id = private.current_org_id());

-- agents: readable org-wide, writable by admins only.
create policy agents_select_same_org on public.agents
  for select to authenticated
  using (organization_id = private.current_org_id());

create policy agents_write_admin on public.agents
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());

-- conversations, messages, tickets, tool call log: any member of the
-- organization works the support queue.
create policy conversations_all_same_org on public.conversations
  for all to authenticated
  using (organization_id = private.current_org_id())
  with check (organization_id = private.current_org_id());

create policy messages_all_same_org on public.messages
  for all to authenticated
  using (organization_id = private.current_org_id())
  with check (organization_id = private.current_org_id());

create policy tickets_all_same_org on public.tickets
  for all to authenticated
  using (organization_id = private.current_org_id())
  with check (organization_id = private.current_org_id());

-- The log is an audit trail: readable, never editable from the app. n8n writes
-- it with service_role.
create policy tool_calls_select_same_org on public.tool_calls_log
  for select to authenticated
  using (organization_id = private.current_org_id());

-- Knowledge base: readable org-wide, curated by admins.
create policy kb_documents_select_same_org on public.knowledge_base_documents
  for select to authenticated
  using (organization_id = private.current_org_id());

create policy kb_documents_write_admin on public.knowledge_base_documents
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());

-- Chunks are generated artefacts: visible for debugging, written only by the
-- ingestion workflow via service_role.
create policy kb_chunks_select_same_org on public.knowledge_base_chunks
  for select to authenticated
  using (organization_id = private.current_org_id());
