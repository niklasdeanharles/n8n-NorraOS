-- Governance and simulation.
--
-- Adds the four things the product promises but the schema could not back:
-- human sign-off on critical actions, an audit trail of configuration changes,
-- test-before-launch, and the topic signal the explorer reads.

create type public.approval_status as enum ('pending', 'approved', 'rejected', 'expired');
create type public.audit_action as enum ('create', 'update', 'delete', 'approve', 'reject', 'takeover', 'release');
create type public.test_run_status as enum ('queued', 'running', 'passed', 'failed', 'error');

-- Critical actions wait here instead of executing. create_refund files one of
-- these rather than moving money; anything else with real-world consequences
-- should do the same.
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  agent_id uuid references public.agents (id) on delete set null,
  ticket_id uuid references public.tickets (id) on delete set null,

  -- Which tool wanted to act, and with what.
  tool_name text not null,
  summary text not null check (length(trim(summary)) between 1 and 500),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- Money at stake, when there is any. Drives the sort order in the queue.
  amount numeric(12, 2),
  currency text,

  status public.approval_status not null default 'pending',
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  -- A request nobody answers must not sit pending forever.
  expires_at timestamptz not null default (now() + interval '7 days'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A decision without a decider is not an audit trail.
  constraint approvals_decision_complete check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status = 'expired')
    or (status in ('approved', 'rejected') and decided_by is not null and decided_at is not null)
  )
);

create index approvals_org_status_idx on public.approvals (organization_id, status, created_at desc);
create index approvals_conversation_idx on public.approvals (conversation_id);

create trigger approvals_set_updated_at
  before update on public.approvals
  for each row execute function private.set_updated_at();

-- Who changed what, when. Append-only by policy: no update, no delete.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references public.users (id) on delete set null,
  -- Kept as text so the entry survives the actor being deleted.
  actor_label text not null,
  action public.audit_action not null,
  entity_type text not null,
  entity_id uuid,
  entity_label text,
  -- Only the fields that actually changed, never whole rows: an audit log that
  -- copies every column ends up storing prompts and customer data twice.
  changes jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_log_org_created_idx on public.audit_log (organization_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- Test before launch: a case is an input plus what a good answer must contain.
create table public.agent_test_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  input text not null check (length(trim(input)) > 0),
  -- Substrings the answer must contain, and must not.
  expect_contains text[] not null default array[]::text[],
  expect_absent text[] not null default array[]::text[],
  -- Optionally assert which tool the agent should reach for.
  expect_tool text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_test_cases_agent_idx on public.agent_test_cases (agent_id);

create trigger agent_test_cases_set_updated_at
  before update on public.agent_test_cases
  for each row execute function private.set_updated_at();

create table public.agent_test_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  test_case_id uuid not null references public.agent_test_cases (id) on delete cascade,
  status public.test_run_status not null default 'queued',
  output text,
  -- Which assertion failed, so a red run explains itself without a rerun.
  failures text[] not null default array[]::text[],
  tools_used text[] not null default array[]::text[],
  duration_ms integer check (duration_ms >= 0),
  n8n_execution_id text,
  created_at timestamptz not null default now()
);

create index agent_test_runs_case_idx on public.agent_test_runs (test_case_id, created_at desc);
create index agent_test_runs_agent_idx on public.agent_test_runs (agent_id, created_at desc);

-- Topic explorer and gap detection read these two columns. Topic is set by the
-- agent at the end of a turn; a conversation the knowledge base could not
-- answer is flagged so the gap shows up as a gap rather than a bad review.
alter table public.conversations
  add column topic text,
  add column csat smallint check (csat between 1 and 5),
  add column knowledge_gap boolean not null default false;

create index conversations_topic_idx on public.conversations (organization_id, topic)
  where topic is not null;
create index conversations_knowledge_gap_idx on public.conversations (organization_id)
  where knowledge_gap;
