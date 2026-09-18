-- Tenant root and user profiles.
--
-- One user belongs to exactly one organization. Moving to multi-org later means
-- adding an organization_members table and deprecating users.organization_id;
-- until then that column is the single source of tenancy.

create type public.user_role as enum ('admin', 'agent', 'customer');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  slug extensions.citext not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null,
  full_name text,
  avatar_url text,
  role public.user_role not null default 'agent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_organization_id_idx on public.users (organization_id);
create unique index users_organization_id_email_idx on public.users (organization_id, email);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function private.set_updated_at();

-- The tenancy accessor every RLS policy is built on.
--
-- security definer is load-bearing: it bypasses RLS, which is what stops the
-- policy on public.users from recursing into itself while evaluating. The
-- pinned empty search_path forces every reference below to be qualified.
create or replace function private.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.organization_id
  from public.users u
  where u.id = (select auth.uid());
$$;

create or replace function private.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
  from public.users u
  where u.id = (select auth.uid());
$$;

create or replace function private.is_org_admin()
returns boolean
language sql
stable
as $$
  select private.current_user_role() = 'admin'::public.user_role;
$$;

grant execute on function private.current_org_id() to authenticated;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.is_org_admin() to authenticated;

-- Provisions a profile for every new auth user.
--
-- Signing up with organization_id in the metadata joins an existing org as an
-- agent (the invite path). Signing up without one creates a fresh org and makes
-- the signer its admin (the self-serve path).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_role public.user_role := 'agent';
  v_org_name text;
  v_slug text;
  v_suffix int := 0;
begin
  v_org_id := nullif(new.raw_user_meta_data ->> 'organization_id', '')::uuid;

  if v_org_id is null then
    v_org_name := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'organization_name'), ''),
      split_part(new.email, '@', 1)
    );
    v_slug := coalesce(private.slugify(v_org_name), 'org');

    -- Slugs are unique org-wide; walk a numeric suffix until one is free.
    while exists (select 1 from public.organizations o where o.slug = v_slug::extensions.citext) loop
      v_suffix := v_suffix + 1;
      v_slug := left(coalesce(private.slugify(v_org_name), 'org'), 56) || '-' || v_suffix::text;
    end loop;

    insert into public.organizations (name, slug)
    values (v_org_name, v_slug)
    returning id into v_org_id;

    v_role := 'admin';
  end if;

  insert into public.users (id, organization_id, email, full_name, role)
  values (
    new.id,
    v_org_id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    v_role
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
