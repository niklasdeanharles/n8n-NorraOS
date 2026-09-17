-- Anrufen, statt angerufen zu werden.
--
-- `calls.direction` kennt `'outbound'` seit der ersten Telefonie-Migration, und
-- geschrieben hat es nie jemand: es gab keinen Weg, einen Anruf zu *beginnen*.
-- Das ist der Unterschied zwischen einem Assistenten, der abnimmt, und einem,
-- der etwas erledigt.
--
-- Zwei Tabellen, weil ein Ziel eigenen Zustand hat -- wie oft schon versucht,
-- wann wieder, mit welchem Ergebnis -- und weil der Workflow sie nach
-- "jetzt fällig" abfragt. Als jsonb-Feld an der Kampagne wäre beides nur mit
-- einem Rewrite der ganzen Zeile pro Versuch zu haben, und "fällig" wäre kein
-- Index, sondern ein Full Scan.

-- ---------------------------------------------------------------------------
-- Die Kampagne
-- ---------------------------------------------------------------------------

create type public.campaign_status as enum ('draft', 'running', 'paused', 'done');

/**
 * Prüft die Form von `call_campaigns.calling_window`.
 *
 * Ruhezeiten sind kein Komfort, sondern Recht: ein Werbeanruf um 22 Uhr ist in
 * Deutschland eine Ordnungswidrigkeit. Deshalb steht das Fenster als
 * geprüftes Feld da und nicht als Freitext, den ein Workflow hoffentlich liest.
 *
 * Form: {"mon": ["09:00","17:00"], …}. Ein fehlender Tag heißt: an dem Tag
 * wird nicht angerufen. Das ist die sichere Lesart -- ein vergessener Eintrag
 * schweigt, statt zu wählen.
 */
create or replace function private.calling_window_valid(p_window jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_window is null or p_window = '{}'::jsonb then true
    when jsonb_typeof(p_window) <> 'object' then false
    when exists (
      select 1 from jsonb_object_keys(p_window) as k
      where k not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
    ) then false
    when exists (
      select 1 from jsonb_each(p_window) as e(day, span)
      where jsonb_typeof(span) <> 'array'
         or jsonb_array_length(span) <> 2
         or (span ->> 0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or (span ->> 1) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         -- Ein Fenster, das rückwärts läuft, ist kein Fenster. Ohne diese
         -- Prüfung wäre es eine Kampagne, die nie jemanden erreicht, und das
         -- fiele erst nach Tagen auf.
         or (span ->> 0) >= (span ->> 1)
    ) then false
    else true
  end;
$$;

create table public.call_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (length(trim(name)) between 1 and 200),
  -- Wer anruft und womit. Ohne beides kann die Kampagne nicht laufen; der
  -- Check weiter unten hält das fest, statt es dem Workflow zu überlassen.
  agent_id uuid references public.agents (id) on delete set null,
  phone_number_id uuid references public.phone_numbers (id) on delete set null,

  -- Was der Agent erreichen soll, in einem Satz. Wandert in den System-Prompt
  -- des Gesprächs -- ein Outbound-Anruf ohne Anlass ist ein Anruf, bei dem der
  -- Angerufene nach zehn Sekunden auflegt.
  goal text not null check (length(trim(goal)) between 1 and 2000),
  -- Der erste Satz. Am Telefon entscheidet er, ob es ein Gespräch gibt.
  opening_line text not null default '' check (length(opening_line) <= 500),

  status public.campaign_status not null default 'draft',

  calling_window jsonb not null default '{}'::jsonb
    check (private.calling_window_valid(calling_window)),
  timezone text not null default 'Europe/Berlin' check (length(timezone) between 1 and 64),

  -- Wie oft es der Agent versucht, und wie lange er dazwischen wartet.
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  retry_after_minutes integer not null default 240 check (retry_after_minutes between 15 and 10080),

  -- Obergrenze pro Lauf. Eine Kampagne mit 5000 Zielen soll die Instanz nicht
  -- in einem Durchgang leerwählen -- und bei einem Fehler nicht 5000 Anrufe
  -- weit gekommen sein, bevor es jemand merkt.
  max_concurrent integer not null default 5 check (max_concurrent between 1 and 50),

  started_at timestamptz,
  finished_at timestamptz,

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Eine laufende Kampagne ohne Agent oder ohne Nummer ist die
  -- halb-konfigurierte Falle: sie sieht aktiv aus und wählt nie.
  constraint call_campaigns_runnable check (
    status = 'draft' or (agent_id is not null and phone_number_id is not null)
  )
);

create index call_campaigns_org_status_idx on public.call_campaigns (organization_id, status);

-- ---------------------------------------------------------------------------
-- Die Ziele
-- ---------------------------------------------------------------------------

create type public.target_outcome as enum (
  'pending', 'reached', 'no_answer', 'busy', 'voicemail', 'failed', 'opted_out'
);

create table public.campaign_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  campaign_id uuid not null references public.call_campaigns (id) on delete cascade,

  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  -- Optional: wenn die Nummer schon als Kontakt bekannt ist, hängt das Gespräch
  -- an derselben Historie wie ein eingehender Anruf derselben Person.
  contact_id uuid references public.contacts (id) on delete set null,
  display_name text check (display_name is null or length(trim(display_name)) between 1 and 200),
  -- Was dieser eine Angerufene mitbringt: Vorgangsnummer, Termin, Betrag.
  -- Landet im Kontext des Gesprächs, nicht in der Kampagne.
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),

  outcome public.target_outcome not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  -- Wann dieses Ziel wieder dran ist. `now()` heißt sofort; null heißt nie
  -- wieder -- das ist der Zustand nach einem endgültigen Ergebnis.
  next_attempt_at timestamptz default now(),
  last_attempt_at timestamptz,
  -- Der letzte Anruf zu diesem Ziel. Über ihn hängen Transkript,
  -- Zusammenfassung und extrahierte Variablen dran.
  last_call_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Dieselbe Nummer zweimal in derselben Kampagne wäre ein Doppelanruf, und
  -- den merkt sich der Angerufene.
  constraint campaign_targets_unique_number unique (campaign_id, e164)
);

-- Die Abfrage des Workflows, wörtlich: was ist in dieser Organisation jetzt
-- fällig. Ohne den Index ein Seq-Scan über alle je angelegten Ziele, und zwar
-- bei jedem Durchlauf.
create index campaign_targets_due_idx
  on public.campaign_targets (organization_id, campaign_id, next_attempt_at)
  where outcome = 'pending';

-- ---------------------------------------------------------------------------
-- Was der Anruf davon weiß
-- ---------------------------------------------------------------------------

alter table public.calls
  add column campaign_target_id uuid references public.campaign_targets (id) on delete set null,
  -- Twilios Answering Machine Detection. Ohne diese Spalte wäre ein Anruf auf
  -- einen Anrufbeantworter von einem geführten Gespräch nicht zu unterscheiden
  -- -- und würde als Erfolg in der Auswertung stehen.
  add column answered_by text check (
    answered_by is null or answered_by in ('human', 'machine', 'fax', 'unknown')
  );

comment on column public.calls.answered_by is
  'Ergebnis der Anrufbeantworter-Erkennung. Nur bei ausgehenden Anrufen gesetzt.';

-- Der Rückverweis, erst jetzt möglich: `calls` kannte `campaign_targets` beim
-- Anlegen der Tabelle noch nicht.
alter table public.campaign_targets
  add constraint campaign_targets_last_call_fk
  foreign key (last_call_id) references public.calls (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Mandantentrennung
-- ---------------------------------------------------------------------------

alter table public.call_campaigns enable row level security;
alter table public.campaign_targets enable row level security;

-- RLS entscheidet, *welche* Zeilen jemand sieht. Ob er die Tabelle überhaupt
-- anfassen darf, entscheidet das Grant -- ohne es scheitert schon das select,
-- bevor eine Policy je ausgewertet wird.
grant select, insert, update, delete
  on public.call_campaigns, public.campaign_targets
  to authenticated, service_role;

-- Lesen darf jedes Mitglied der Organisation: eine Kampagne ist Arbeitsstand,
-- kein Geheimnis.
create policy call_campaigns_select on public.call_campaigns
  for select using (organization_id = private.current_org_id());

-- Anlegen und Ändern nur Admins. Eine Kampagne wählt Rufnummern und kostet
-- Geld; das ist keine Tätigkeit für ein Support-Konto.
create policy call_campaigns_admin on public.call_campaigns
  for all using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());

create policy campaign_targets_select on public.campaign_targets
  for select using (organization_id = private.current_org_id());

create policy campaign_targets_admin on public.campaign_targets
  for all using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());

create trigger call_campaigns_set_updated_at
  before update on public.call_campaigns
  for each row execute function private.set_updated_at();

create trigger campaign_targets_set_updated_at
  before update on public.campaign_targets
  for each row execute function private.set_updated_at();
