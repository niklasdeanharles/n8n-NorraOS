-- Tickets raised out of conversations, and the audit trail of every tool the
-- agent invoked.

create type public.ticket_status as enum ('open', 'pending', 'solved', 'closed');
create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.ticket_source as enum ('agent_escalation', 'manual', 'email', 'api');
create type public.tool_call_status as enum ('pending', 'success', 'error');

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  agent_id uuid references public.agents (id) on delete set null,

  subject text not null check (length(trim(subject)) between 1 and 500),
  description text,
  status public.ticket_status not null default 'open',
  priority public.ticket_priority not null default 'normal',
  source public.ticket_source not null default 'agent_escalation',

  assignee_id uuid references public.users (id) on delete set null,
  tags text[] not null default array[]::text[],
  -- Ids in external systems, e.g. {"shopify_order_id": "..."}.
  external_ref jsonb not null default '{}'::jsonb check (jsonb_typeof(external_ref) = 'object'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index tickets_org_status_idx on public.tickets (organization_id, status, created_at desc);
create index tickets_conversation_id_idx on public.tickets (conversation_id);
create index tickets_assignee_id_idx on public.tickets (assignee_id) where assignee_id is not null;

create trigger tickets_set_updated_at
  before update on public.tickets
  for each row execute function private.set_updated_at();

create table public.tool_calls_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  agent_id uuid references public.agents (id) on delete set null,

  tool_name text not null,
  -- The n8n ids are the way back from a row here to the execution in the n8n UI.
  n8n_workflow_id text,
  n8n_execution_id text,

  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status public.tool_call_status not null default 'pending',
  error text,
  duration_ms integer check (duration_ms >= 0),

  created_at timestamptz not null default now()
);

create index tool_calls_conversation_idx on public.tool_calls_log (conversation_id, created_at desc);
create index tool_calls_org_tool_idx on public.tool_calls_log (organization_id, tool_name, created_at desc);
