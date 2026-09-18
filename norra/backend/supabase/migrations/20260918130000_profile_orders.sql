-- Was einen Agenten von einer Branche in die nächste trägt.
--
-- Bisher steht `[Unternehmen]` als Platzhalter im System-Prompt und wird von
-- Hand ersetzt. Das funktioniert genau einmal — beim zweiten Agenten derselben
-- Organisation steht der Firmenname ein zweites Mal irgendwo im Fließtext, und
-- beim Umbenennen findet ihn niemand wieder. Ein Profil an der Organisation
-- löst das: einmal gepflegt, von jedem Agenten lesbar.
--
-- Dazu die Quelle, aus der ein Agent Bestellungen nachschlägt — die Frage, die
-- in fast jeder Branche als Erstes kommt und die er bisher nur raten konnte.
--
-- Bewusst **nicht** hier: Stimmung, Risiko und das Voicemail-Transkript. Die
-- gehören zu Workflows, die es noch nicht gibt, und eine Spalte ohne Schreiber
-- ist eine Spalte, die für immer leer bleibt — `check-wiring.mjs` sagt das auch
-- so. Sie kommen mit ihrem Schreiber zusammen.

-- ---------------------------------------------------------------------------
-- Das Unternehmen, über das der Agent spricht
-- ---------------------------------------------------------------------------

alter table public.organizations
  -- Wie der Agent das Haus nennt. Oft nicht identisch mit `name`: der Account
  -- heißt „Müller GmbH", am Telefon sagt man „Bäckerei Müller".
  add column display_name text check (display_name is null or length(trim(display_name)) between 1 and 200),

  -- Die Branche. Freitext und kein Enum: Branchen sind unendlich, und ein Enum
  -- hieße, dass ein Hufschmied erst auf eine Migration wartet. Die Vorlagen
  -- schlagen Werte vor, erzwingen aber keinen.
  add column industry text check (industry is null or length(trim(industry)) between 1 and 120),

  -- Ein bis zwei Sätze, die der Agent über das Haus sagen darf. Kurz gehalten,
  -- weil das hier kein Ersatz für die Wissensbasis ist, sondern die Antwort auf
  -- „was macht ihr eigentlich?".
  add column about text check (about is null or length(trim(about)) between 1 and 600),

  -- Öffnungszeiten in Worten, zum Vorlesen. Nicht zu verwechseln mit
  -- `phone_numbers.business_hours`: das ist die Schaltlogik, das hier ist der
  -- Satz. Beides getrennt zu halten ist Absicht — „Mo–Fr 8–18, Sa nach
  -- Vereinbarung" lässt sich nicht aus einer Zeitmatrix zurückgewinnen.
  add column hours_note text check (hours_note is null or length(trim(hours_note)) between 1 and 400);

-- ---------------------------------------------------------------------------
-- Woher der Agent Bestellungen holt
-- ---------------------------------------------------------------------------

create type public.order_source_kind as enum ('google_sheet', 'http');

create table public.order_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  label text not null check (length(trim(label)) between 1 and 120),
  kind public.order_source_kind not null,

  -- Google Sheet
  sheet_id text check (sheet_id is null or length(trim(sheet_id)) between 1 and 200),
  sheet_range text check (sheet_range is null or length(trim(sheet_range)) between 1 and 120),

  -- Eigener Endpunkt
  endpoint_url text check (endpoint_url is null or endpoint_url ~ '^https://'),

  -- In welcher Spalte die Bestellnummer steht. Ohne das müsste der Workflow
  -- raten, und Raten heißt hier: die falsche Bestellung vorlesen.
  match_column text not null check (length(trim(match_column)) between 1 and 80),

  -- **Welche Spalten der Anrufer hören darf.** Eine Bestelltabelle trägt fast
  -- immer mehr als den Status: Einkaufspreis, Marge, interne Notizen. Die ganze
  -- Zeile ans Modell zu geben hieße, sie früher oder später vorzulesen. Also
  -- wird aufgezählt, was hinaus darf — und nichts sonst.
  -- `coalesce`, weil `array_length` bei einem leeren Array NULL liefert und
  -- nicht 0 — und ein CHECK, der NULL ergibt, gilt als erfüllt. Ohne das
  -- rutschte genau der Fall durch, den diese Regel verhindern soll. Der Test
  -- hat es gefunden, nicht das Nachdenken.
  return_columns text[] not null check (
    coalesce(array_length(return_columns, 1), 0) between 1 and 12
    and array_position(return_columns, null) is null
  ),

  active boolean not null default true,

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Jede Art braucht, was sie braucht. Eine Quelle ohne Ziel ist ein Tool, das
  -- im Gespräch scheitert statt beim Anlegen.
  constraint order_sources_sheet_complete
    check (kind <> 'google_sheet' or (sheet_id is not null and sheet_range is not null)),
  constraint order_sources_http_complete
    check (kind <> 'http' or endpoint_url is not null)
);

create index order_sources_active_idx on public.order_sources (organization_id, active);

-- ---------------------------------------------------------------------------
-- Mandantentrennung
-- ---------------------------------------------------------------------------

alter table public.order_sources enable row level security;

grant select, insert, update, delete on public.order_sources to authenticated, service_role;

-- Lesen darf jeder im Haus: wer am Telefon sitzt, muss wissen, woher die
-- Auskunft kommt.
create policy order_sources_select on public.order_sources
  for select using (organization_id = private.current_org_id());

-- Ändern nur Admins. Wer hier einträgt, entscheidet, welche Tabelle ein Modell
-- vorlesen darf.
create policy order_sources_admin on public.order_sources
  for all using (organization_id = private.current_org_id() and private.is_org_admin())
  with check (organization_id = private.current_org_id() and private.is_org_admin());

create trigger order_sources_set_updated_at
  before update on public.order_sources
  for each row execute function private.set_updated_at();
