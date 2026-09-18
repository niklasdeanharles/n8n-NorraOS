-- Stand-in for the pieces Supabase provides that plain Postgres does not.
--
-- Only for running the migrations and tenancy tests against a bare Postgres --
-- locally or in CI. Never applied to a real Supabase project, which already has
-- all of this. Kept idempotent because roles are cluster-wide and survive a
-- dropdb.

create schema if not exists extensions;
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Matches Supabase: this is the role n8n connects as, and it bypasses RLS.
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public, extensions to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Supabase reads the JWT claims; for tests the subject is set with set_config.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;
