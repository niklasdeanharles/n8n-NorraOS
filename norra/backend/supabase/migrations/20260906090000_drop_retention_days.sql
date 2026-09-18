-- Removes a promise the product never kept.
--
-- `organizations.retention_days` was settable in the console between 7 and 3650
-- days, and an admin could reasonably read that as "conversations disappear
-- after N days". Nothing ever deleted anything: no job, no trigger, no policy.
-- A tenant asking for erasure under GDPR would have been shown a setting the
-- system does not honour.
--
-- Rolling it back is the honest move. When retention is actually built -- a
-- scheduled job that removes conversations, messages, calls and recordings past
-- the cut-off and records the run in the audit log -- the column comes back in
-- the same migration as the job that reads it.
--
-- The check constraint goes with the column; dropping the column drops it.

alter table public.organizations
  drop column if exists retention_days;
