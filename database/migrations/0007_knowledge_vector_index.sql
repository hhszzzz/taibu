-- migrate:no-transaction
-- One HNSW index for the only supported embedding width. The generated column
-- lets the planner use the partial index without re-reading JSON metadata.
alter table public.knowledge_entries
  add column if not exists embedding_dim integer
  generated always as (extensions.vector_dims(content_vector)) stored;

create index concurrently if not exists knowledge_entries_vector_1024_hnsw_idx
  on public.knowledge_entries using hnsw ((content_vector::extensions.vector(1024)) extensions.vector_cosine_ops)
  where embedding_dim = 1024;

create or replace function public.check_vector_index_exists(p_dim integer default null)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and (
        (p_dim is not null and indexname = 'knowledge_entries_vector_' || p_dim || '_hnsw_idx')
        or (p_dim is null and indexname like 'knowledge_entries_vector_%_hnsw_idx')
      )
  );
$$;

create or replace function public.search_knowledge_vector(
  p_query_vector double precision[],
  p_kb_ids uuid[] default null,
  p_limit integer default 20,
  p_dim integer default 1536
) returns table(id uuid, kb_id uuid, content text, metadata jsonb, distance real)
language plpgsql
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if array_length(p_query_vector, 1) != p_dim then
    raise exception 'Query vector dimension (%) does not match p_dim (%)',
      array_length(p_query_vector, 1), p_dim;
  end if;

  return query execute format('
    select e.id, e.kb_id, e.content, e.metadata,
      (e.content_vector::extensions.vector(%s) <=> $1::extensions.vector(%s))::real as distance
    from public.knowledge_entries e
    join public.knowledge_bases kb on e.kb_id = kb.id
    where kb.user_id = $2
      and ($3 is null or e.kb_id = any($3))
      and e.embedding_dim = $4
    order by e.content_vector::extensions.vector(%s) <=> $1::extensions.vector(%s)
    limit $5', p_dim, p_dim, p_dim, p_dim)
  using p_query_vector::extensions.vector, v_user_id, p_kb_ids, p_dim, p_limit;
end;
$function$;

revoke all on function public.check_vector_index_exists(integer) from public;
grant execute on function public.check_vector_index_exists(integer) to authenticated, service_role;
revoke all on function public.search_knowledge_vector(double precision[], uuid[], integer, integer) from public;
grant execute on function public.search_knowledge_vector(double precision[], uuid[], integer, integer) to authenticated;
