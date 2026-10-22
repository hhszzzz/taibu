-- Bounded, idempotent retention for Agent history. Every pass deletes at most
-- p_limit rows, and the caller stops when a pass returns fewer than the limit.
create or replace function public.delete_agent_retention(
  p_event_days integer default 30,
  p_commit_days integer default 7,
  p_worker_hours integer default 24,
  p_limit integer default 1000
) returns table(events_deleted bigint, commits_deleted bigint, workers_deleted bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_events bigint;
  v_commits bigint;
  v_workers bigint;
begin
  if not public.is_admin_user() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_event_days < 7 or p_commit_days < 1 or p_worker_hours < 1 or p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid retention bounds' using errcode = '22023';
  end if;

  delete from public.agent_run_events
  where run_id in (
    select id from public.agent_runs
    where status in ('completed', 'failed', 'cancelled')
      and updated_at < now() - make_interval(days => p_event_days)
    limit p_limit
  );
  get diagnostics v_events = row_count;

  delete from public.agent_durable_commits
  where run_id in (
    select id from public.agent_runs
    where status in ('completed', 'failed', 'cancelled')
      and updated_at < now() - make_interval(days => p_commit_days)
    limit p_limit
  );
  get diagnostics v_commits = row_count;

  delete from public.agent_workers
  where id in (
    select id from public.agent_workers
    where heartbeat_at < now() - make_interval(hours => p_worker_hours)
    limit p_limit
  );
  get diagnostics v_workers = row_count;

  return query select v_events, v_commits, v_workers;
end;
$$;

revoke all on function public.delete_agent_retention(integer, integer, integer, integer) from public;
grant execute on function public.delete_agent_retention(integer, integer, integer, integer) to authenticated;
