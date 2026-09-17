-- Wenn der Anrufer eine andere Sprache spricht.
--
-- Die Sprache hängt bisher an der Leitung: `phone_numbers.language` bestimmt,
-- in welcher Sprache erkannt und gesprochen wird, und zwar für den ganzen
-- Anruf. Ein Empfang, der nur eine Sprache kann, schickt jeden anderen weg —
-- und zwar mit einem Satz, den dieser Mensch nicht versteht.
--
-- Was hier **nicht** passiert: das Modell nennt die Sprache frei. Der Wert geht
-- direkt in ein TwiML-Attribut, und eine erfundene Zeichenkette dort ist
-- entweder ein Fehler beim Anbieter oder eine Roboterstimme. Also gilt dieselbe
-- Regel wie beim Durchstellen: das Modell nennt einen Namen, die Route schlägt
-- ihn in dieser Tabelle nach, und was nicht drinsteht, wird nicht gesprochen.

create table public.phone_languages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  phone_number_id uuid not null references public.phone_numbers (id) on delete cascade,

  -- BCP-47 in der Form, die Twilio erwartet: `de-DE`, `en-US`, `tr-TR`.
  code text not null check (code ~ '^[a-z]{2}-[A-Z]{2}$'),

  -- Die Stimme zur Sprache. Eine deutsche Stimme, die Englisch liest, klingt
  -- wie eine Parodie — deshalb hängt sie an der Sprache und nicht an der
  -- Leitung.
  voice text not null check (length(trim(voice)) between 1 and 60),

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Eine Sprache gibt es je Leitung einmal. Zwei Zeilen für `en-US` wären zwei
-- Stimmen für denselben Satz, und welche gewinnt, entschiede die Sortierung.
create unique index phone_languages_unique_idx
  on public.phone_languages (phone_number_id, code);

-- Welche Sprache gerade gesprochen wird, steht am Anruf und nicht an der
-- Leitung: sie gilt für dieses Gespräch, nicht für das nächste. Null heißt, es
-- gilt weiter, was an der Nummer eingestellt ist.
alter table public.calls add column language text
  check (language is null or language ~ '^[a-z]{2}-[A-Z]{2}$');
alter table public.calls add column voice text
  check (voice is null or length(trim(voice)) between 1 and 60);

-- Eine Stimme ohne Sprache wäre eine halbe Umschaltung: gesprochen würde
-- anders, erkannt weiterhin auf Deutsch.
alter table public.calls add constraint calls_language_pairs
  check ((language is null) = (voice is null));

alter table public.phone_languages enable row level security;

grant select, insert, update, delete on public.phone_languages to authenticated, service_role;

create policy phone_languages_select on public.phone_languages
  for select using (organization_id = private.current_org_id());

create policy phone_languages_admin on public.phone_languages
  for all using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());

create trigger phone_languages_set_updated_at
  before update on public.phone_languages
  for each row execute function private.set_updated_at();
