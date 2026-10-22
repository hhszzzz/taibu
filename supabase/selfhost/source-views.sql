-- Reviewed view excerpts supplied for the local baseline; no source data.
-- Original: supabase/migrations/20260329_optimize_rls_hotspots_and_view_security.sql
--           + supabase/migrations/20261017_100000_conversation_list_agent_flag.sql (has_agent_run)
-- Original SHA256: a10f7ca9935b086b851829d067f86dc5e483d4c24db48c6aa58a64142cdf83aa
CREATE OR REPLACE VIEW public.conversations_with_archive_status AS
SELECT
    c.id,
    c.user_id,
    c.personality,
    c.title,
    c.messages,
    c.created_at,
    c.updated_at,
    c.source_type,
    c.source_data,
    EXISTS (
        SELECT 1
        FROM public.archived_sources a
        WHERE a.source_type = 'conversation'
          AND a.source_id = c.id::text
          AND a.user_id = c.user_id
    ) AS is_archived,
    (
        SELECT array_agg(a.kb_id)
        FROM public.archived_sources a
        WHERE a.source_type = 'conversation'
          AND a.source_id = c.id::text
          AND a.user_id = c.user_id
    ) AS archived_kb_ids,
    EXISTS (
        SELECT 1
        FROM public.agent_runs r
        WHERE r.conversation_id = c.id
          AND r.user_id = c.user_id
    ) AS has_agent_run
FROM public.conversations c;
ALTER VIEW public.conversations_with_archive_status SET (security_invoker = on);

-- Original: supabase/migrations/20260125_update_archived_source_views.sql
--           + supabase/migrations/20261021_120000_agent_user_archive.sql (source_conversation_id; same definition)
-- Original SHA256: 6ffab78803ca8a51556412366967ffd6316930be414fa484d2c5e86a9b18a369
CREATE OR REPLACE VIEW public.ming_records_with_archive_status AS
SELECT
    r.*,
    EXISTS (
        SELECT 1 FROM public.archived_sources a
        WHERE a.source_type = 'record'
        AND a.source_id = r.id::text
    ) AS is_archived,
    (
        SELECT array_agg(kb_id)
        FROM public.archived_sources a
        WHERE a.source_type = 'record'
        AND a.source_id = r.id::text
    ) AS archived_kb_ids,
    (SELECT s.conversation_id FROM public.agent_runs s WHERE s.id = r.source_run_id) AS source_conversation_id
FROM public.ming_records r;
ALTER VIEW public.ming_records_with_archive_status SET (security_invoker = on);

-- Local ACL: caller-invoker reads only; no anonymous or view mutation grants.
REVOKE ALL ON public.conversations_with_archive_status, public.ming_records_with_archive_status
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.conversations_with_archive_status, public.ming_records_with_archive_status
  TO authenticated, service_role;
