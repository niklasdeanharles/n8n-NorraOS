-- Agent configuration.
--
-- This is data, not workflow: the n8n agent-turn workflow loads a row here at
-- the start of every turn and feeds it into the AI Agent node. Changing a bot's
-- behaviour must never require touching a workflow.

create type public.agent_status as enum ('draft', 'live', 'archived');

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  slug extensions.citext not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  description text,
  status public.agent_status not null default 'draft',

  -- Model behaviour
  system_prompt text not null default '',
  model text not null default 'claude-opus-5',
  temperature numeric(3, 2) not null default 0.2 check (temperature between 0 and 2),
  max_tokens integer not null default 4096 check (max_tokens between 1 and 200000),

  -- {"allowed_topics": [], "forbidden_topics": [], "refusal_message": null}
  guardrails jsonb not null default '{}'::jsonb check (jsonb_typeof(guardrails) = 'object'),
  -- [{"slug": "lookup_record", "enabled": true, "config": {"url": "https://..."}}]
  -- config is what makes a generic tool concrete for one customer.
  tools jsonb not null default '[]'::jsonb check (jsonb_typeof(tools) = 'array'),
  -- {"on_low_confidence": true, "on_keywords": [...], "target": "email|slack"}
  escalation_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(escalation_rules) = 'object'),

  -- Which channels this agent answers on. Present from day one so multi-channel
  -- is a configuration change rather than a migration.
  channels text[] not null default array['web']::text[] check (cardinality(channels) > 0),

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index agents_organization_id_slug_idx on public.agents (organization_id, slug);
create index agents_organization_id_status_idx on public.agents (organization_id, status);

create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function private.set_updated_at();
