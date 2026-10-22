-- Nightly removal of expired Better Auth rows. Kept as a SECURITY DEFINER
-- function because the application role has no privileges on identity.
create or replace function public.cleanup_expired_identity_rows(p_limit integer default 5000)
returns table(sessions_deleted bigint, verifications_deleted bigint)
language plpgsql
security definer
set search_path = identity, public, pg_temp
as $$
declare
  v_sessions bigint;
  v_verifications bigint;
begin
  if not public.is_admin_user() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from identity.sessions
  where id in (
    select id from identity.sessions where expires_at < now() - interval '1 day' limit p_limit
  );
  get diagnostics v_sessions = row_count;
  delete from identity.verifications
  where id in (
    select id from identity.verifications where expires_at < now() - interval '1 day' limit p_limit
  );
  get diagnostics v_verifications = row_count;
  return query select v_sessions, v_verifications;
end;
$$;

revoke all on function public.cleanup_expired_identity_rows(integer) from public;
grant execute on function public.cleanup_expired_identity_rows(integer) to authenticated;
