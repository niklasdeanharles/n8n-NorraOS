-- Two limits on the one surface strangers can reach.
--
-- The widget endpoints are anonymous by design: a visitor on a customer's
-- website has no account and never will. That leaves two things unguarded, and
-- both are cheap for an attacker and expensive for the customer.
--
--   1. Nothing capped how often a session could be minted or a turn taken.
--      Every turn is a Claude call plus an embedding query, billed to the
--      customer whose agent id is sitting in the embed script on their own site.
--
--   2. Nothing tied an agent to the sites allowed to embed it. Any page could
--      mount someone else's agent, answer under its own name, and spend their
--      budget.

-- ---------------------------------------------------------------------------
-- Where an agent may be embedded
-- ---------------------------------------------------------------------------

-- A check constraint may not contain a subquery, so the element-wise test lives
-- in an immutable function. Immutable is what makes it usable in a constraint
-- at all -- and it is honest here: the answer depends only on the input.
create or replace function private.origins_valid(p_origins text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_origins is null
      or cardinality(p_origins) = 0
      or (
        cardinality(p_origins) <= 20
        -- Scheme and host as a browser sends them in Origin: no path, no
        -- trailing slash, optional port. Anything else would never match the
        -- header and would silently lock the agent out of its own site.
        and bool_and(o ~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$')
      )
  from unnest(coalesce(p_origins, '{}'::text[])) as o;
$$;

alter table public.agents
  -- Origins as the browser sends them. Empty means "anywhere", so every agent
  -- that exists today keeps working and the check is opt-in per agent.
  add column allowed_origins text[] not null default '{}'::text[]
    check (private.origins_valid(allowed_origins));

comment on column public.agents.allowed_origins is
  'Origins allowed to mint a widget session for this agent. Empty = any origin.';

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

-- One row per (bucket, window). Postgres rather than Redis because the app
-- already has a database and does not have a Redis; the write is a single
-- upsert and the table stays small because expired windows are swept on write.
create table public.rate_limits (
  -- What is being limited: "session:<ip hash>" or "turn:<conversation id>".
  -- Opaque on purpose -- see hash_bucket below for why an IP never lands here
  -- in the clear.
  bucket text not null check (length(bucket) between 1 and 200),
  -- Start of the fixed window this count belongs to.
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (bucket, window_start)
);

-- Sweeping needs to find old rows without scanning the whole table.
create index rate_limits_window_idx on public.rate_limits (window_start);

-- Nobody reads this through PostgREST. The function below is the only door.
revoke all on table public.rate_limits from public, authenticated, anon;

/**
 * Counts one hit and says whether it is still within the limit.
 *
 * Atomic on purpose: read-then-write would let two requests arriving in the
 * same millisecond both see "9 of 10" and both proceed. The insert-on-conflict
 * increments and returns in one statement, so the count is exact under load --
 * which is precisely the condition a rate limit exists for.
 *
 * Fixed windows, not a sliding log: a burst can straddle a boundary and get up
 * to 2x the limit for one moment. That is the accepted cost of one row per
 * window instead of one row per request.
 */
create or replace function public.take_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'take_rate_limit needs a positive limit and window';
  end if;

  -- Floor now() onto the window grid, so every caller in the same window
  -- addresses the same row.
  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, window_start, count)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update
    set count = public.rate_limits.count + 1
  returning count into v_count;

  -- Sweep opportunistically rather than on a schedule: no cron to forget, and
  -- the cost is spread across the traffic that created the rows. 1-in-1000
  -- keeps it off the hot path.
  if random() < 0.001 then
    delete from public.rate_limits
    where window_start < clock_timestamp() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

-- Only the routes call this, and they run with service_role. A browser session
-- that could call it directly could also drain someone else's budget by
-- burning their window.
revoke all on function public.take_rate_limit(text, integer, integer) from public, authenticated, anon;
grant execute on function public.take_rate_limit(text, integer, integer) to service_role;
