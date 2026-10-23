-- migrate:no-transaction
-- The runner drops invalid remnants of these indexes before replaying this
-- file. Valid indexes remain in place. Also repairs installations whose older
-- runner recorded a migration after IF NOT EXISTS skipped an invalid index.
create index concurrently if not exists agent_claim_queued
  on public.agent_runs (created_at)
  where status = 'queued'
    and checkpoint->>'version' = '2'
    and checkpoint#>>'{durable,engine}' = 'pi-durable/1.3.0';

create index concurrently if not exists agent_claim_expired
  on public.agent_runs (lease_until, created_at)
  where status in ('running', 'cancelling')
    and checkpoint->>'version' = '2'
    and checkpoint#>>'{durable,engine}' = 'pi-durable/1.3.0';

create index concurrently if not exists knowledge_entries_vector_1024_hnsw_idx
  on public.knowledge_entries using hnsw ((content_vector::extensions.vector(1024)) extensions.vector_cosine_ops)
  where embedding_dim = 1024;

create or replace function public.check_vector_index_exists(p_dim integer default null)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and i.indisvalid and i.indisready
      and ((p_dim is not null and c.relname = 'knowledge_entries_vector_' || p_dim || '_hnsw_idx')
        or (p_dim is null and c.relname like 'knowledge_entries_vector_%_hnsw_idx'))
  );
$$;
revoke all on function public.check_vector_index_exists(integer) from public;
grant execute on function public.check_vector_index_exists(integer) to authenticated, service_role;
