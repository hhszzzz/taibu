-- Fix function search_path warnings
DO $$
DECLARE
    fn record;
BEGIN
    FOR fn IN
        SELECT
            n.nspname AS schema_name,
            p.proname AS function_name,
            pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'update_vote_count',
              'decrement_ai_chat_count',
              'check_rate_limit',
              'cleanup_old_rate_limits',
              'restore_ai_chat_count',
              'increment_community_post_view_count',
              'update_user_credits_updated_at',
              'cleanup_old_login_attempts',
              'update_post_comment_count',
              'update_conversations_updated_at',
              'increment_ai_chat_count'
          )
    LOOP
        EXECUTE format(
            'ALTER FUNCTION %I.%I(%s) SET search_path = public',
            fn.schema_name,
            fn.function_name,
            fn.args
        );
    END LOOP;
END $$;

-- Move pg_trgm out of public schema
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
DECLARE
    current_schema text;
BEGIN
    SELECT n.nspname INTO current_schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm';

    IF current_schema = 'public' THEN
        EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
    END IF;
END $$;
