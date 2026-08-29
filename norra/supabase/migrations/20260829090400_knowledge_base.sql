-- Knowledge base: documents and their embedded chunks.
--
-- knowledge_base_chunks has to satisfy two masters. n8n's Supabase Vector Store
-- node goes through LangChain's SupabaseVectorStore, which on insert writes
-- exactly {content, embedding, metadata} and nothing else -- real foreign key
-- columns would never be populated by it. So the columns stay, and a BEFORE
-- INSERT trigger projects organization_id and document_id out of metadata into
-- them. That keeps the stock node usable while we still get referential
-- integrity, cascade deletes and an indexable RLS predicate.

create type public.kb_source_type as enum ('upload', 'url', 'text', 'shopify');
create type public.kb_document_status as enum ('pending', 'processing', 'ready', 'failed');

create table public.knowledge_base_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- null means the document is shared across every agent in the organization.
  agent_id uuid references public.agents (id) on delete cascade,

  title text not null check (length(trim(title)) between 1 and 500),
  source_type public.kb_source_type not null default 'upload',
  source_url text,
  -- Path in Supabase Storage for uploaded files.
  storage_path text,
  mime_type text,
  -- Content hash, so re-ingesting an unchanged document is a no-op.
  checksum text,

  status public.kb_document_status not null default 'pending',
  error text,
  chunk_count integer not null default 0 check (chunk_count >= 0),

  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index kb_documents_organization_id_idx on public.knowledge_base_documents (organization_id);
create index kb_documents_agent_id_idx on public.knowledge_base_documents (agent_id);
create unique index kb_documents_org_checksum_idx
  on public.knowledge_base_documents (organization_id, checksum)
  where checksum is not null;

create trigger kb_documents_set_updated_at
  before update on public.knowledge_base_documents
  for each row execute function private.set_updated_at();

create table public.knowledge_base_chunks (
  -- LangChain's canonical table uses bigint here; uuid is fine as long as
  -- match_kb_chunks declares the same type in its RETURNS TABLE.
  id uuid primary key default gen_random_uuid(),

  -- Written by the trigger below when the vector store node omits them.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null references public.knowledge_base_documents (id) on delete cascade,

  -- The three columns LangChain's SupabaseVectorStore actually writes.
  content text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  -- 1536 dimensions = OpenAI text-embedding-3-small.
  embedding extensions.vector(1536),

  chunk_index integer check (chunk_index >= 0),
  token_count integer check (token_count >= 0),
  created_at timestamptz not null default now()
);

-- Projects tenancy out of metadata into real columns, and writes it back so the
-- vector store's own metadata filter path stays consistent with the columns.
-- NOT NULL is checked after BEFORE triggers, so the constraints above still hold.
create or replace function private.kb_chunk_sync_metadata()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is null then
    new.organization_id := nullif(new.metadata ->> 'organization_id', '')::uuid;
  end if;

  if new.document_id is null then
    new.document_id := nullif(new.metadata ->> 'document_id', '')::uuid;
  end if;

  if new.organization_id is null or new.document_id is null then
    raise exception using
      errcode = '23502',
      message = 'knowledge_base_chunks needs organization_id and document_id, as columns or in metadata',
      hint = 'The n8n ingestion workflow must put both ids into each document''s metadata.';
  end if;

  new.metadata := new.metadata || jsonb_build_object(
    'organization_id', new.organization_id::text,
    'document_id', new.document_id::text
  );

  return new;
end;
$$;

create trigger kb_chunks_sync_metadata
  before insert or update on public.knowledge_base_chunks
  for each row execute function private.kb_chunk_sync_metadata();

create index kb_chunks_organization_id_idx on public.knowledge_base_chunks (organization_id);
create index kb_chunks_document_id_idx on public.knowledge_base_chunks (document_id);

-- HNSW over cosine distance: the right default for pgvector >= 0.5 at this size.
create index kb_chunks_embedding_idx
  on public.knowledge_base_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- Keeps knowledge_base_documents.chunk_count in step with reality.
create or replace function private.kb_document_recount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_id uuid := coalesce(new.document_id, old.document_id);
begin
  update public.knowledge_base_documents d
  set chunk_count = (
    select count(*) from public.knowledge_base_chunks c where c.document_id = v_document_id
  )
  where d.id = v_document_id;
  return null;
end;
$$;

create trigger kb_chunks_recount
  after insert or delete on public.knowledge_base_chunks
  for each row execute function private.kb_document_recount();
