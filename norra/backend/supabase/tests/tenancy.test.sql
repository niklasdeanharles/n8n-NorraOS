-- Executable form of the multi-tenant rules in norra/CLAUDE.md.
--
-- Run against a scratch database that has the migrations applied:
--   supabase db reset
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/tests/tenancy.test.sql
--
-- Every check raises on failure, so a non-zero exit means tenancy is broken.
-- The whole thing runs in a transaction and rolls back.

begin;

do $$
declare
  v_ada uuid := '11111111-1111-1111-1111-111111111111';
  v_bob uuid := '22222222-2222-2222-2222-222222222222';
  v_eve uuid := '33333333-3333-3333-3333-333333333333';
  v_org_a uuid;
  v_org_b uuid;
  v_doc uuid;
  v_vec extensions.vector(1536) := (select array_agg(0.01::real)::extensions.vector from generate_series(1, 1536));
  v_count integer;
  v_role public.user_role;
begin
  -- Self-serve signup creates an org and makes the signer its admin.
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_ada, 'ada@tenancy.test', '{"organization_name":"Tenancy A","full_name":"Ada"}');

  select organization_id, role into v_org_a, v_role from public.users where id = v_ada;
  if v_org_a is null then raise exception 'signup did not provision an organization'; end if;
  if v_role <> 'admin' then raise exception 'first user of a new org must be admin, got %', v_role; end if;

  -- Invited signup joins the existing org as an agent.
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_bob, 'bob@tenancy.test', jsonb_build_object('organization_id', v_org_a::text));

  select organization_id, role into v_org_b, v_role from public.users where id = v_bob;
  if v_org_b <> v_org_a then raise exception 'invited user landed in the wrong organization'; end if;
  if v_role <> 'agent' then raise exception 'invited user must default to agent, got %', v_role; end if;

  -- A second tenant, to check nothing leaks between them.
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_eve, 'eve@tenancy.test', '{"organization_name":"Tenancy B"}');
  select organization_id into v_org_b from public.users where id = v_eve;
  if v_org_b = v_org_a then raise exception 'second signup was folded into the first org'; end if;

  insert into public.agents (organization_id, name, slug, status)
  values (v_org_a, 'A Bot', 'a-bot', 'live'), (v_org_b, 'B Bot', 'b-bot', 'live');
  insert into public.conversations (organization_id, agent_id, channel)
  select organization_id, id, 'web' from public.agents;

  insert into public.knowledge_base_documents (organization_id, title)
  values (v_org_a, 'Tenant A handbook') returning id into v_doc;

  -- The exact shape LangChain's SupabaseVectorStore inserts: no id columns,
  -- tenancy only in metadata. The trigger has to project it out.
  insert into public.knowledge_base_chunks (content, metadata, embedding)
  values ('Tenant A secret.', jsonb_build_object(
    'organization_id', v_org_a::text, 'document_id', v_doc::text), v_vec);

  select count(*) into v_count from public.knowledge_base_chunks
  where organization_id = v_org_a and document_id = v_doc;
  if v_count <> 1 then raise exception 'metadata was not projected into columns'; end if;

  select chunk_count into v_count from public.knowledge_base_documents where id = v_doc;
  if v_count <> 1 then raise exception 'chunk_count was not maintained, got %', v_count; end if;

  -- Rule 2: RLS isolates the authenticated (Next.js) path.
  set local role authenticated;

  perform set_config('request.jwt.claim.sub', v_ada::text, true);
  select count(*) into v_count from public.conversations;
  if v_count <> 1 then raise exception 'admin sees % conversations, expected only their own', v_count; end if;

  perform set_config('request.jwt.claim.sub', v_eve::text, true);
  select count(*) into v_count from public.knowledge_base_chunks;
  if v_count <> 0 then raise exception 'tenant B can see % of tenant A chunks', v_count; end if;

  begin
    insert into public.conversations (organization_id, channel) values (v_org_a, 'web');
    raise exception 'cross-tenant insert was allowed';
  exception when insufficient_privilege then null;
  end;

  -- A plain agent must not be able to rewrite agent configuration.
  perform set_config('request.jwt.claim.sub', v_bob::text, true);
  update public.agents set system_prompt = 'hijacked';
  if found then raise exception 'a non-admin rewrote agent configuration'; end if;

  reset role;

  -- Rule 3: n8n runs as service_role and bypasses RLS entirely, so the RPC
  -- itself must refuse to answer an unscoped question.
  set local role service_role;

  begin
    perform * from public.match_kb_chunks(v_vec, 5, '{}'::jsonb);
    raise exception 'match_kb_chunks answered without an organization id';
  exception when invalid_parameter_value then null;
  end;

  select count(*) into v_count from public.match_kb_chunks(
    query_embedding => v_vec, match_count => 5,
    filter => jsonb_build_object('organization_id', v_org_a::text));
  if v_count <> 1 then raise exception 'scoped retrieval returned % rows, expected 1', v_count; end if;

  select count(*) into v_count from public.match_kb_chunks(
    query_embedding => v_vec, match_count => 5,
    filter => jsonb_build_object('organization_id', v_org_b::text));
  if v_count <> 0 then raise exception 'tenant B retrieved % of tenant A chunks', v_count; end if;

  reset role;

  raise notice 'tenancy: all checks passed';
end $$;

rollback;
