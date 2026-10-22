-- Wake Agent workers and SSE streams through LISTEN/NOTIFY instead of polling.
-- Payloads stay well below PostgreSQL's 8000-byte NOTIFY limit.

create or replace function public.agent_notify_event() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_notify('taibu_agent', json_build_object(
    't', 'event',
    'run', NEW.run_id,
    'seq', NEW.sequence
  )::text);
  return NEW;
end;
$$;

create or replace function public.agent_notify_run() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_notify('taibu_agent', json_build_object(
    't', 'run',
    'run', NEW.id,
    'status', NEW.status,
    'cancel', coalesce(NEW.cancel_requested, false)
  )::text);
  if NEW.status = 'queued' then
    perform pg_notify('taibu_agent', json_build_object('t', 'queue')::text);
  end if;
  return NEW;
end;
$$;

create or replace function public.agent_notify_command() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_notify('taibu_agent', json_build_object(
    't', 'cmd',
    'run', NEW.run_id
  )::text);
  return NEW;
end;
$$;

drop trigger if exists agent_notify_event on public.agent_run_events;
create trigger agent_notify_event
  after insert on public.agent_run_events
  for each row execute function public.agent_notify_event();

drop trigger if exists agent_notify_run on public.agent_runs;
create trigger agent_notify_run
  after insert or update of status, cancel_requested on public.agent_runs
  for each row execute function public.agent_notify_run();

drop trigger if exists agent_notify_command on public.agent_run_commands;
create trigger agent_notify_command
  after insert on public.agent_run_commands
  for each row execute function public.agent_notify_command();

revoke all on function public.agent_notify_event() from public;
revoke all on function public.agent_notify_run() from public;
revoke all on function public.agent_notify_command() from public;
