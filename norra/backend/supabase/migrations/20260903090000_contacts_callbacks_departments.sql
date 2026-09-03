-- What a phone call needs beyond a chat.
--
-- A caller has no session, no account page, no way to look anything up. Three
-- gaps follow from that, and each gets a table here:
--
--   contacts    -- a chat visitor is anonymous by default; a caller arrives with
--                  a number, and that number is the only handle we ever get on
--                  them. Recognising it across calls is the difference between
--                  "Wie kann ich helfen?" and "Sie hatten letzte Woche wegen
--                  der Rechnung angerufen -- geht es darum?"
--
--   callbacks   -- a caller cannot wait in a queue the way a chat window can sit
--                  open. Offering a callback is how a call ends well when the
--                  answer is not available now.
--
--   phone_departments
--               -- a chat hands off to whoever picks up the inbox. A call has to
--                  go to a specific number, and "the one transfer number" is not
--                  how a support organisation is shaped.

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- The handle. E.164 so the same person dialling from abroad still matches.
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),

  -- Everything below is what a human eventually fills in. The row is created by
  -- the first call, when all we know is the number.
  display_name text check (display_name is null or length(trim(display_name)) between 1 and 200),
  email extensions.citext
    check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  note text check (note is null or length(note) <= 2000),

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  call_count integer not null default 0 check (call_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per number per tenant. Two tenants may legitimately serve the same
-- person, and neither may see the other's note about them.
create unique index contacts_org_e164_idx on public.contacts (organization_id, e164);

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function private.set_updated_at();

-- The caller on a conversation, once we know who it is. Nullable: chat and
-- widget conversations have no contact, and a call has none until the number
-- resolves.
alter table public.conversations
  add column contact_id uuid references public.contacts (id) on delete set null;

create index conversations_contact_idx on public.conversations (contact_id)
  where contact_id is not null;

alter table public.calls
  add column contact_id uuid references public.contacts (id) on delete set null;

-- ---------------------------------------------------------------------------
-- callbacks
-- ---------------------------------------------------------------------------

create type public.callback_status as enum ('pending', 'done', 'cancelled');

create table public.callbacks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,

  -- The number to ring back. Copied rather than joined: a contact row can be
  -- edited or deleted, and a promise to call back at a number has to survive
  -- that.
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),

  -- What the caller asked for, in their words. The agent does not get to invent
  -- a slot in the team's calendar; it records a wish and a human confirms it.
  requested_for timestamptz,
  preference text check (preference is null or length(preference) <= 300),
  reason text not null check (length(trim(reason)) between 1 and 2000),

  status public.callback_status not null default 'pending',
  assignee_id uuid references public.users (id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index callbacks_org_status_idx on public.callbacks (organization_id, status, created_at desc);

create trigger callbacks_set_updated_at
  before update on public.callbacks
  for each row execute function private.set_updated_at();

-- A finished callback has to say when and by whom; an open one must not claim to.
alter table public.callbacks
  add constraint callbacks_completion_consistent
  check (
    (status = 'done' and completed_at is not null)
    or (status <> 'done' and completed_at is null and completed_by is null)
  );

-- ---------------------------------------------------------------------------
-- phone_departments
-- ---------------------------------------------------------------------------

create table public.phone_departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (length(trim(name)) between 1 and 80),

  -- Where the call actually goes. This column is the whole point of the table:
  -- the agent names a department, the server looks the number up here. A number
  -- the model produced is never dialled.
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),

  -- Read by the agent to decide. Written for a model, not for a human: "Fragen
  -- zu Rechnungen, Mahnungen, Zahlungsarten" routes better than "Buchhaltung".
  description text not null check (length(trim(description)) between 1 and 500),

  -- Eine Abteilung laesst sich pausieren, ohne sie zu verlieren: Urlaubsvertretung,
  -- eine Nummer, die gerade umzieht. Der Agent sieht nur aktive.
  active boolean not null default true,

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The agent picks a department by name, so a name has to mean one thing.
create unique index phone_departments_org_name_idx
  on public.phone_departments (organization_id, lower(trim(name)));

create index phone_departments_org_active_idx
  on public.phone_departments (organization_id)
  where active;

create trigger phone_departments_set_updated_at
  before update on public.phone_departments
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Keeping the contact current
-- ---------------------------------------------------------------------------

-- Called by the voice webhook when a call comes in. Doing it in one statement
-- rather than select-then-insert is what makes two simultaneous calls from the
-- same number produce one contact instead of a unique violation.
create or replace function public.touch_contact(
  p_organization_id uuid,
  p_e164 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.contacts (organization_id, e164, call_count)
  values (p_organization_id, p_e164, 1)
  on conflict (organization_id, e164) do update
    set last_seen_at = now(),
        call_count = public.contacts.call_count + 1
  returning id into v_id;

  return v_id;
end;
$$;

-- Only the webhooks call this, and they already resolved the organization from
-- the dialled number. Nothing in the browser needs it.
revoke all on function public.touch_contact(uuid, text) from public, authenticated;
grant execute on function public.touch_contact(uuid, text) to service_role;
