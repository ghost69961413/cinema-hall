-- ==============================================================
-- CINEMA HALL TICKET BOOKING SYSTEM - PG_CRON SCHEDULE
-- Releases expired held seats every minute
-- Note: In Supabase, pg_cron extension must be enabled in Project Settings -> Database -> Extensions
-- ==============================================================

create extension if not exists pg_cron;

-- Unschedule first if already scheduled to avoid duplicate cron jobs
do $$
begin
  perform cron.unschedule('release-holds');
exception
  when others then null;
end $$;

-- Schedule release_expired_holds() to run every minute
select cron.schedule(
  'release-holds',
  '* * * * *',
  'select public.release_expired_holds()'
);
