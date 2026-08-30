-- Telephony: numbers, calls, and the organization settings a workflow reads.
--
-- A phone call is a conversation with channel 'voice'; this migration adds what
-- a call has that a chat does not -- a number it arrived on, a duration, an
-- outcome -- plus the per-number configuration that makes the assistant set up
-- by filling a form rather than by editing a workflow.

-- ---------------------------------------------------------------- settings --

-- Promoted out of organizations.settings. Both columns are read by workflows,
-- and a jsonb blob is where a typo lives forever: nothing rejects
-- {"escalaton_email": ...}, and the mail silently stops arriving.
alter table public.organizations
  add column escalation_email extensions.citext
    check (escalation_email is null or escalation_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add column timezone text not null default 'Europe/Berlin' check (length(timezone) between 1 and 64),
  add column locale text not null default 'de' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  -- Null means keep forever. The floor is deliberate: a one-day retention would
  -- delete the conversation a customer is still complaining about.
  add column retention_days integer check (retention_days is null or retention_days between 7 and 3650);

-- Carry over whatever the jsonb blob already held, so no organization loses its
-- escalation address on deploy.
update public.organizations
set escalation_email = nullif(settings ->> 'escalation_email', '')::extensions.citext
where settings ? 'escalation_email'
  and nullif(settings ->> 'escalation_email', '') is not null
  and nullif(settings ->> 'escalation_email', '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';

comment on column public.organizations.settings is
  'Presentation preferences only. Anything a workflow or policy reads gets a real column.';

-- ----------------------------------------------------------------- numbers --

create type public.telephony_provider as enum ('twilio');
create type public.phone_number_status as enum ('unconfigured', 'active', 'paused');
-- What happens to a call that arrives outside business hours.
create type public.after_hours_behavior as enum ('agent', 'voicemail', 'transfer', 'reject');

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- E.164, the only format a telephony provider hands us.
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  label text check (label is null or length(trim(label)) between 1 and 120),
  provider public.telephony_provider not null default 'twilio',
  -- The provider's own id for the number (Twilio: PN...). Lets an operator find
  -- the same number on the other side without matching on digits.
  provider_sid text,

  -- Null is allowed on purpose: a number can exist before an agent is picked,
  -- which is the state the setup wizard starts in.
  agent_id uuid references public.agents (id) on delete set null,

  greeting text not null default '' check (length(greeting) <= 2000),
  -- Provider voice id. Not an enum: providers add voices constantly and a
  -- migration per voice would be absurd.
  voice text not null default 'Polly.Vicki-Neural' check (length(voice) between 1 and 80),
  language text not null default 'de-DE' check (language ~ '^[a-z]{2}-[A-Z]{2}$'),

  transfer_number text check (transfer_number is null or transfer_number ~ '^\+[1-9][0-9]{6,14}$'),
  voicemail_message text check (voicemail_message is null or length(voicemail_message) <= 2000),

  -- A runaway loop on a phone line bills by the minute, so the ceiling is part
  -- of the configuration rather than a constant in the code.
  max_call_seconds integer not null default 600 check (max_call_seconds between 30 and 3600),
  recording_enabled boolean not null default false,

  -- {"mon": [["08:00", "17:00"]], "sat": []} -- a day with no entry is closed.
  business_hours jsonb not null default '{}'::jsonb check (jsonb_typeof(business_hours) = 'object'),
  timezone text not null default 'Europe/Berlin' check (length(timezone) between 1 and 64),
  after_hours after_hours_behavior not null default 'agent',

  status public.phone_number_status not null default 'unconfigured',
  last_call_at timestamptz,

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Global, not per-organization: an inbound call carries only the dialled
-- number, so two organizations claiming it would make routing ambiguous -- and
-- ambiguous routing across tenants is a data leak, not an inconvenience.
create unique index phone_numbers_e164_idx on public.phone_numbers (e164);
create index phone_numbers_organization_id_idx on public.phone_numbers (organization_id);
create index phone_numbers_agent_id_idx on public.phone_numbers (agent_id) where agent_id is not null;

create trigger phone_numbers_set_updated_at
  before update on public.phone_numbers
  for each row execute function private.set_updated_at();

-- A number cannot go live without someone to answer it.
alter table public.phone_numbers
  add constraint phone_numbers_active_needs_agent
  check (status <> 'active' or agent_id is not null);

-- Nor can it fall back to a transfer it does not have.
alter table public.phone_numbers
  add constraint phone_numbers_transfer_needs_number
  check (after_hours <> 'transfer' or transfer_number is not null);

-- ------------------------------------------------------------------- calls --

create type public.call_status as enum (
  'ringing', 'in_progress', 'completed', 'failed', 'no_answer', 'busy', 'transferred', 'voicemail'
);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  phone_number_id uuid references public.phone_numbers (id) on delete set null,
  -- Every answered call has a conversation; the transcript lives in messages,
  -- so this table stays about the call itself.
  conversation_id uuid references public.conversations (id) on delete cascade,
  agent_id uuid references public.agents (id) on delete set null,

  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  -- The provider's call id (Twilio: CA...). Unique, because every webhook for a
  -- call arrives more than once in practice and must land on the same row.
  provider_call_id text not null,
  from_e164 text,
  to_e164 text,

  status public.call_status not null default 'ringing',
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  turn_count integer not null default 0 check (turn_count >= 0),

  recording_url text,
  transferred_to text,
  ended_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index calls_provider_call_id_idx on public.calls (provider_call_id);
create index calls_org_started_idx on public.calls (organization_id, started_at desc);
create index calls_conversation_id_idx on public.calls (conversation_id) where conversation_id is not null;
create index calls_phone_number_id_idx on public.calls (phone_number_id) where phone_number_id is not null;

create trigger calls_set_updated_at
  before update on public.calls
  for each row execute function private.set_updated_at();
