CREATE OR REPLACE FUNCTION public.search_knowledge_fts(
    p_query TEXT,
    p_kb_ids UUID[] DEFAULT NULL,
    p_limit INT DEFAULT 20,
    p_config TEXT DEFAULT 'simple'
)
RETURNS TABLE (
    id UUID,
    kb_id UUID,
    content TEXT,
    metadata JSONB,
    rank REAL
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_safe_config TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_safe_config := CASE
        WHEN p_config IN ('simple', 'english') THEN p_config
        ELSE 'simple'
    END;

    RETURN QUERY
    SELECT
        e.id,
        e.kb_id,
        e.content,
        e.metadata,
        ts_rank(to_tsvector(v_safe_config, e.content), plainto_tsquery(v_safe_config, p_query)) AS rank
    FROM knowledge_entries e
    JOIN knowledge_bases kb ON e.kb_id = kb.id
    WHERE kb.user_id = v_user_id
      AND (p_kb_ids IS NULL OR e.kb_id = ANY(p_kb_ids))
      AND to_tsvector(v_safe_config, e.content) @@ plainto_tsquery(v_safe_config, p_query)
    ORDER BY rank DESC
    LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_knowledge_trigram(
    p_query TEXT,
    p_kb_ids UUID[] DEFAULT NULL,
    p_limit INT DEFAULT 20,
    p_threshold REAL DEFAULT 0.3
)
RETURNS TABLE (
    id UUID,
    kb_id UUID,
    content TEXT,
    metadata JSONB,
    similarity REAL
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    RETURN QUERY
    SELECT
        e.id,
        e.kb_id,
        e.content,
        e.metadata,
        similarity(e.content, p_query) AS similarity
    FROM knowledge_entries e
    JOIN knowledge_bases kb ON e.kb_id = kb.id
    WHERE kb.user_id = v_user_id
      AND (p_kb_ids IS NULL OR e.kb_id = ANY(p_kb_ids))
      AND similarity(e.content, p_query) > p_threshold
    ORDER BY similarity DESC
    LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_knowledge_vector(
    p_query_vector float8[],
    p_kb_ids UUID[] DEFAULT NULL,
    p_limit INT DEFAULT 20,
    p_dim INT DEFAULT 1536
)
RETURNS TABLE (
    id UUID,
    kb_id UUID,
    content TEXT,
    metadata JSONB,
    distance REAL
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF array_length(p_query_vector, 1) != p_dim THEN
        RAISE EXCEPTION 'Query vector dimension (%) does not match p_dim (%)',
            array_length(p_query_vector, 1), p_dim;
    END IF;

    RETURN QUERY EXECUTE format('
        SELECT
            e.id,
            e.kb_id,
            e.content,
            e.metadata,
            (e.content_vector::vector(%s) <=> $1::vector(%s))::real AS distance
        FROM knowledge_entries e
        JOIN knowledge_bases kb ON e.kb_id = kb.id
        WHERE kb.user_id = $2
          AND ($3 IS NULL OR e.kb_id = ANY($3))
          AND e.content_vector IS NOT NULL
          AND (e.metadata->>''embedding_dim'')::int = $4
        ORDER BY distance ASC
        LIMIT $5
    ', p_dim, p_dim)
    USING p_query_vector::vector, v_user_id, p_kb_ids, p_dim, p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_knowledge_fts(TEXT, UUID[], INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge_trigram(TEXT, UUID[], INT, REAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge_vector(float8[], UUID[], INT, INT) TO authenticated;
