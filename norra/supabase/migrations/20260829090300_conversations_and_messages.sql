-- Conversations and their message history.
--
-- Both n8n and Next.js write here; it is the only integration surface between
-- them. Supabase Realtime broadcasts inserts to the chat UI and the handoff
-- dashboard.

create type public.conversation_channel as enum ('web', 'email', 'whatsapp', 'voice', 'slack', 'api');
create type public.conversation_status as enum ('open', 'pending', 'escalated', 'resolved', 'closed');
create type public.message_role as enum ('user', 'assistant', 'system', 'tool');

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- Agents are archived, never deleted; set null keeps history readable if one
  -- is removed anyway, and lets an organization delete cascade cleanly.
  agent_id uuid references public.agents (id) on delete set null,

  channel public.conversation_channel not null default 'web',
  -- Channel-native thread id (email thread, WhatsApp conversation, ...).
  external_id text,

  end_user_name text,
  end_user_email extensions.citext,
  -- Identity in the customer's own system, e.g. a CRM contact id.
  end_user_external_id text,

  status public.conversation_status not null default 'open',
  -- Set when a human takes over.
  assigned_user_id uuid references public.users (id) on delete set null,

  title text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),

  last_message_at timestamptz,
  escalated_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index conversations_channel_external_id_idx
  on public.conversations (organization_id, channel, external_id)
  where external_id is not null;
create index conversations_org_status_recent_idx
  on public.conversations (organization_id, status, last_message_at desc nulls last);
create index conversations_agent_id_idx on public.conversations (agent_id);
create index conversations_assigned_user_id_idx
  on public.conversations (assigned_user_id)
  where assigned_user_id is not null;

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function private.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  -- Monotonic ordering key. created_at ties on fast tool turns, so it cannot be
  -- the sort key on its own.
  seq bigint generated always as identity,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,

  role public.message_role not null,
  content text not null default '',
  -- Structured payload for tool calls and rich channel content.
  content_json jsonb check (content_json is null or jsonb_typeof(content_json) in ('object', 'array')),

  model text,
  tokens_in integer check (tokens_in >= 0),
  tokens_out integer check (tokens_out >= 0),
  latency_ms integer check (latency_ms >= 0),
  -- Links a row back to the execution in the n8n UI.
  n8n_execution_id text,

  created_at timestamptz not null default now()
);

create index messages_conversation_seq_idx on public.messages (conversation_id, seq);
create index messages_organization_id_idx on public.messages (organization_id);

-- Keeps the dashboard's "most recent activity" sort cheap.
create or replace function private.bump_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id
    and (last_message_at is null or last_message_at < new.created_at);
  return new;
end;
$$;

create trigger messages_bump_conversation
  after insert on public.messages
  for each row execute function private.bump_conversation_last_message();
