-- Was einen Empfang von einer Telefonanlage unterscheidet.
--
-- Norra kann Abteilungen. Ein Empfang kennt aber **Menschen**: „Ist Frau Vogel
-- da?" ist die häufigste Frage an einem Empfangstresen, und „Sagen Sie ihr, der
-- Termin am Freitag fällt aus" der häufigste Auftrag. Für beides gab es keine
-- Zeile in der Datenbank.
--
-- Eine Nachricht ist dabei nicht dasselbe wie ein Rückruf: ein Rückruf ist eine
-- Bitte um einen zweiten Anruf, eine Nachricht ist der Inhalt selbst. Wer beides
-- in `callbacks` presst, verliert entweder den Text oder die Rückrufnummer.

-- ---------------------------------------------------------------------------
-- Die Menschen hinter der Nummer
-- ---------------------------------------------------------------------------

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (length(trim(name)) between 1 and 200),
  role text check (role is null or length(trim(role)) between 1 and 120),

  -- Wohin durchgestellt wird. Die Durchwahl ist das, was ein Anrufer nennt;
  -- gewählt wird immer `e164`.
  e164 text check (e164 is null or e164 ~ '^\+[1-9][0-9]{6,14}$'),
  extension text check (extension is null or extension ~ '^[0-9]{1,8}$'),
  email text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'),

  -- Zwei getrennte Schalter, weil es zwei getrennte Fragen sind: wer Anrufe
  -- annimmt, und wer Nachrichten bekommt. Eine Geschäftsführerin nimmt
  -- vielleicht keine Anrufe entgegen, Nachrichten aber sehr wohl.
  accepts_transfers boolean not null default true,
  accepts_messages boolean not null default true,
  active boolean not null default true,

  -- Was der Agent über diese Person sagen darf, wenn jemand nach ihr fragt.
  -- Freitext und bewusst kurz: „zuständig für Großkunden, Di und Do im Haus".
  note text check (note is null or length(trim(note)) between 1 and 500),

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Durchstellen ohne Nummer ist ein Versprechen, das beim ersten Anruf bricht.
  constraint staff_members_transferable check (not accepts_transfers or e164 is not null),
  -- Eine Nachricht ohne Zustellweg bliebe in der Datenbank liegen und niemand
  -- wüsste davon. Dann lieber gar nicht erst annehmen.
  constraint staff_members_reachable check (not accepts_messages or email is not null or e164 is not null)
);

create unique index staff_members_extension_idx
  on public.staff_members (organization_id, extension)
  where extension is not null;

create index staff_members_active_idx on public.staff_members (organization_id, active);

-- ---------------------------------------------------------------------------
-- Die Nachricht selbst
-- ---------------------------------------------------------------------------

create type public.message_urgency as enum ('normal', 'dringend');
create type public.message_status as enum ('neu', 'zugestellt', 'erledigt');

create table public.messages_for_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  staff_member_id uuid not null references public.staff_members (id) on delete cascade,

  -- Woher sie kommt. Beide optional: eine Nachricht kann auch im Chat
  -- entstehen, und dann gibt es keinen Anruf.
  call_id uuid references public.calls (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,

  caller_name text check (caller_name is null or length(trim(caller_name)) between 1 and 200),
  caller_e164 text check (caller_e164 is null or caller_e164 ~ '^\+[1-9][0-9]{6,14}$'),

  body text not null check (length(trim(body)) between 1 and 2000),
  urgency public.message_urgency not null default 'normal',
  status public.message_status not null default 'neu',

  -- Wann sie rausging und wer sie abgehakt hat. Ohne das erste wäre nicht zu
  -- unterscheiden, ob die Zustellung scheiterte oder nie versucht wurde.
  delivered_at timestamptz,
  handled_at timestamptz,
  handled_by uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint messages_for_staff_handled check (
    (status = 'erledigt') = (handled_at is not null)
  )
);

create index messages_for_staff_open_idx
  on public.messages_for_staff (organization_id, created_at desc)
  where status <> 'erledigt';

-- ---------------------------------------------------------------------------
-- Was der Mitarbeiter vor dem Verbinden hört
-- ---------------------------------------------------------------------------

alter table public.calls
  -- Ein Satz für die *angerufene* Seite: wer dran ist und worum es geht. Twilio
  -- spielt ihn über `<Number url="…">` nur ihr vor, während der Anrufer im
  -- Freizeichen wartet.
  --
  -- Als Spalte und nicht als Query-Parameter, weil ein Parameter ein Satz wäre,
  -- den jeder mit einer gültigen Signatur frei wählen könnte. Hier schreibt ihn
  -- der Agenten-Lauf, und die Route liest ihn nur.
  add column transfer_briefing text check (
    transfer_briefing is null or length(trim(transfer_briefing)) between 1 and 500
  );

comment on column public.calls.transfer_briefing is
  'Ansage für den Mitarbeiter vor dem Verbinden. Der Anrufer hört sie nicht.';

-- ---------------------------------------------------------------------------
-- Mitschnitt nur mit Ansage
-- ---------------------------------------------------------------------------

alter table public.phone_numbers
  -- Der Satz, den ein Anrufer hört, bevor aufgezeichnet wird. In Deutschland
  -- ist der Mitschnitt eines Gesprächs ohne Einwilligung strafbar
  -- (§ 201 StGB), und eine Einwilligung setzt voraus, dass jemand vorher
  -- Bescheid weiß.
  add column recording_notice text check (
    recording_notice is null or length(trim(recording_notice)) between 10 and 500
  );

comment on column public.phone_numbers.recording_notice is
  'Ansage vor dem Mitschnitt. Ohne sie darf recording_enabled nicht gesetzt werden.';

-- Die Erzwingung steht hier und nicht in der Route: eine Route kann man
-- umgehen, ein Check-Constraint nicht. Bestehende Nummern haben
-- `recording_enabled = false` und bleiben davon unberührt.
alter table public.phone_numbers
  add constraint phone_numbers_recording_needs_notice
  check (not recording_enabled or recording_notice is not null);

-- ---------------------------------------------------------------------------
-- Mandantentrennung
-- ---------------------------------------------------------------------------

alter table public.staff_members enable row level security;
alter table public.messages_for_staff enable row level security;

grant select, insert, update, delete
  on public.staff_members, public.messages_for_staff
  to authenticated, service_role;

-- Das Verzeichnis liest jeder im Haus: es ist das Telefonbuch.
create policy staff_members_select on public.staff_members
  for select using (organization_id = private.current_org_id());

-- Ändern nur Admins. Wer hier einträgt, entscheidet, wohin Anrufe gehen.
create policy staff_members_admin on public.staff_members
  for all using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());

-- Nachrichten liest und bearbeitet jeder, der am Telefon sitzt — dafür sind
-- sie da. Sie zu löschen bleibt Admins vorbehalten.
create policy messages_for_staff_read on public.messages_for_staff
  for select using (organization_id = private.current_org_id());

create policy messages_for_staff_write on public.messages_for_staff
  for insert with check (organization_id = private.current_org_id());

create policy messages_for_staff_update on public.messages_for_staff
  for update using (organization_id = private.current_org_id())
  with check (organization_id = private.current_org_id());

create policy messages_for_staff_delete on public.messages_for_staff
  for delete using (organization_id = private.current_org_id() and private.is_org_admin());

create trigger staff_members_set_updated_at
  before update on public.staff_members
  for each row execute function private.set_updated_at();

create trigger messages_for_staff_set_updated_at
  before update on public.messages_for_staff
  for each row execute function private.set_updated_at();
