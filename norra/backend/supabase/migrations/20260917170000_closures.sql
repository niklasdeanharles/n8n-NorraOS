-- Tage, an denen niemand da ist.
--
-- `phone_numbers.business_hours` kennt nur die Woche: Montag bis Freitag,
-- acht bis achtzehn. Das reicht für 250 Tage im Jahr und ist an den übrigen
-- falsch. Ein Assistent, der am ersten Weihnachtstag „wir sind für Sie da"
-- sagt, weil Donnerstag im Kalender steht, ist schlimmer als einer, der gar
-- nichts sagt: er schickt jemanden los, der dann vor verschlossener Tür steht.
--
-- Bewusst **keine** eingebaute Feiertagsliste. Feiertage sind pro Bundesland
-- verschieden, ändern sich (Fronleichnam ja, Reformationstag je nach Land),
-- und Betriebsferien stehen in keinem Kalender. Eine mitgelieferte Liste wäre
-- für die Hälfte der Kunden falsch, ohne dass sie es merken. Also trägt sie
-- jeder selbst ein — einmal im Jahr, in einem Formular.

create table public.closure_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- Null heißt: gilt für alle Leitungen dieser Organisation. Der Normalfall —
  -- an Weihnachten ist das ganze Haus zu, nicht eine Durchwahl.
  phone_number_id uuid references public.phone_numbers (id) on delete cascade,

  -- Ein Bereich, kein einzelner Tag: Betriebsferien sind zwei Wochen, und
  -- vierzehn Zeilen dafür anzulegen lädt zum Vergessen der letzten ein.
  starts_on date not null,
  ends_on date not null,

  label text not null check (length(trim(label)) between 1 and 120),

  -- Was der Anrufer hört. Leer heißt: es gilt, was unter `after_hours` für
  -- diese Nummer eingestellt ist. Gesetzt heißt: dieser Satz kommt zuerst,
  -- denn „wir haben Betriebsferien bis zum 6. Januar" ist eine andere
  -- Auskunft als „außerhalb unserer Öffnungszeiten".
  message text check (message is null or length(trim(message)) between 5 and 500),

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Ein Bereich, der vor seinem Anfang endet, schließt nie. Er sähe im
  -- Formular aber genauso aus wie einer, der das ganze Jahr schließt.
  constraint closure_days_ordered check (ends_on >= starts_on)
);

-- Die Abfrage im Anrufpfad lautet immer: „gilt heute für diese Nummer etwas?"
create index closure_days_lookup_idx
  on public.closure_days (organization_id, starts_on, ends_on);

alter table public.closure_days enable row level security;

grant select, insert, update, delete on public.closure_days to authenticated, service_role;

-- Lesen darf jeder im Haus: wer am Telefon sitzt, muss wissen, wann zu ist.
create policy closure_days_select on public.closure_days
  for select using (organization_id = private.current_org_id());

-- Eintragen nur Admins. Ein Schließtag schaltet eine Leitung ab.
create policy closure_days_admin on public.closure_days
  for all using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());

create trigger closure_days_set_updated_at
  before update on public.closure_days
  for each row execute function private.set_updated_at();
