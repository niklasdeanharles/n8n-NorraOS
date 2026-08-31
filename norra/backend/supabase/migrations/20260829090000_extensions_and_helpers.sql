-- Extensions and helpers shared by every later migration.
--
-- Types are referenced schema-qualified (extensions.vector, extensions.citext)
-- throughout, so nothing depends on search_path being set a particular way.

create extension if not exists vector with schema extensions;
create extension if not exists citext with schema extensions;

-- Helpers that must bypass RLS live here. PostgREST only exposes the schemas
-- listed in its config (public, graphql_public), so `private` is unreachable
-- over the API no matter what is granted below.
create schema if not exists private;

grant usage on schema private to authenticated, service_role;

-- Keeps updated_at honest. Attached per table in the migrations that follow.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Lowercases, strips accents-free non-alphanumerics and collapses dashes.
-- Returns null for input that has no usable characters at all.
create or replace function private.slugify(p_input text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both '-' from regexp_replace(lower(coalesce(p_input, '')), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;
