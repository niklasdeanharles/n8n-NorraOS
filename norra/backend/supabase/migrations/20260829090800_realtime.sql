-- Realtime: n8n writes results with service_role, Supabase pushes them to every
-- open client. This is how the chat UI and the handoff dashboard stay live
-- without Next.js polling or holding a connection to n8n.
--
-- Guarded so the migration also applies to a bare Postgres without the Supabase
-- realtime publication.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
    alter publication supabase_realtime add table public.conversations;
    alter publication supabase_realtime add table public.tickets;
    alter publication supabase_realtime add table public.tool_calls_log;
  end if;
end;
$$;

-- Dashboards diff conversation and ticket updates (status changes, assignment),
-- which needs the old row in the WAL. Messages and the tool log are
-- insert-only, so they keep the cheaper default.
alter table public.conversations replica identity full;
alter table public.tickets replica identity full;
