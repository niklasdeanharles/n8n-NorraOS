-- Retrieval RPC for the n8n Supabase Vector Store node.
--
-- LangChain calls this with named arguments {query_embedding, match_count,
-- filter} and nothing else, so p_organization_id has to be defaultable -- which
-- means the tenant id normally arrives inside `filter`. Since n8n queries with
-- service_role and bypasses RLS, this function is the only thing standing
-- between one tenant's question and another tenant's documents. It therefore
-- refuses to run at all without an organization id, from either source.
--
-- Configure the node with: Query Name = match_kb_chunks, Table = knowledge_base_chunks,
-- Metadata Filter = {"organization_id": "<org uuid>"}.
create or replace function public.match_kb_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 5,
  filter jsonb default '{}'::jsonb,
  p_organization_id uuid default null
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity double precision
)
language plpgsql
stable
as $$
declare
  v_org_id uuid := coalesce(p_organization_id, nullif(filter ->> 'organization_id', '')::uuid);
  v_limit integer := least(greatest(coalesce(match_count, 5), 1), 100);
begin
  if v_org_id is null then
    raise exception using
      errcode = '22023',
      message = 'match_kb_chunks requires an organization id',
      hint = 'Pass p_organization_id, or put organization_id into the metadata filter.';
  end if;

  return query
  select
    c.id,
    c.content,
    c.metadata,
    (1 - (c.embedding operator(extensions.<=>) query_embedding))::double precision as similarity
  from public.knowledge_base_chunks c
  where c.organization_id = v_org_id
    and c.embedding is not null
    -- Remaining filter keys (agent_id, document_id, ...) still apply.
    and c.metadata @> (filter - 'organization_id')
  order by c.embedding operator(extensions.<=>) query_embedding
  limit v_limit;
end;
$$;

-- security invoker (the default) is deliberate: called by `authenticated` the
-- RLS policy applies on top, so the app path is protected twice over.
revoke all on function public.match_kb_chunks(extensions.vector, integer, jsonb, uuid) from public, anon;
grant execute on function public.match_kb_chunks(extensions.vector, integer, jsonb, uuid)
  to authenticated, service_role;
