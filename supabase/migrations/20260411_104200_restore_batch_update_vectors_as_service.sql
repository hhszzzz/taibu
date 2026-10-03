CREATE OR REPLACE FUNCTION public.batch_update_vectors_as_service(
    p_updates JSONB,
    p_user_id UUID,
    p_expected_dim INT DEFAULT 1536,
    p_force_overwrite BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    updated_count INT,
    skipped_count INT,
    already_exists_count INT,
    error_details JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_update JSONB;
    v_entry_id UUID;
    v_vector_jsonb JSONB;
    v_vector_arr float8[];
    v_vector vector;
    v_updated INT := 0;
    v_skipped INT := 0;
    v_already_exists INT := 0;
    v_errors JSONB := '[]'::jsonb;
    v_dim INT;
    v_elem JSONB;
    v_elem_text TEXT;
    v_elem_type TEXT;
    v_has_invalid_elem BOOLEAN;
    v_invalid_elem_info TEXT;
    v_ord INT;
BEGIN
    IF auth.role() != 'service_role' THEN
        IF NOT public.is_admin_user() THEN
            RAISE EXCEPTION 'Unauthorized';
        END IF;
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;

    FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
    LOOP
        v_entry_id := (v_update->>'id')::uuid;
        v_vector_jsonb := v_update->'content_vector';

        IF v_vector_jsonb IS NULL THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'content_vector is NULL');
            CONTINUE;
        END IF;

        IF jsonb_typeof(v_vector_jsonb) = 'null' THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'content_vector is JSON null');
            CONTINUE;
        END IF;

        IF jsonb_typeof(v_vector_jsonb) != 'array' THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object(
                'id', v_entry_id,
                'reason', 'content_vector is not an array',
                'actual_type', jsonb_typeof(v_vector_jsonb)
            );
            CONTINUE;
        END IF;

        IF jsonb_array_length(v_vector_jsonb) = 0 THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'content_vector is empty array');
            CONTINUE;
        END IF;

        v_has_invalid_elem := FALSE;
        v_invalid_elem_info := NULL;
        v_ord := 0;

        FOR v_elem IN SELECT value FROM jsonb_array_elements(v_vector_jsonb)
        LOOP
            v_ord := v_ord + 1;
            v_elem_type := jsonb_typeof(v_elem);

            IF v_elem_type = 'null' THEN
                v_has_invalid_elem := TRUE;
                v_invalid_elem_info := format('element[%s] is null', v_ord - 1);
                EXIT;
            END IF;

            IF v_elem_type NOT IN ('number') THEN
                v_has_invalid_elem := TRUE;
                v_invalid_elem_info := format('element[%s] is %s, expected number', v_ord - 1, v_elem_type);
                EXIT;
            END IF;

            v_elem_text := v_elem::text;
            IF v_elem_text IN ('NaN', 'Infinity', '-Infinity', 'null')
               OR v_elem_text !~ '^-?[0-9]+\\.?[0-9]*([eE][+-]?[0-9]+)?$' THEN
                v_has_invalid_elem := TRUE;
                v_invalid_elem_info := format('element[%s] is invalid: %s', v_ord - 1, v_elem_text);
                EXIT;
            END IF;
        END LOOP;

        IF v_has_invalid_elem THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object(
                'id', v_entry_id,
                'reason', 'invalid_element',
                'detail', v_invalid_elem_info
            );
            CONTINUE;
        END IF;

        SELECT array_agg(t.val::float8 ORDER BY t.ord)
        INTO v_vector_arr
        FROM jsonb_array_elements_text(v_vector_jsonb) WITH ORDINALITY AS t(val, ord);

        IF EXISTS (SELECT 1 FROM unnest(v_vector_arr) AS x WHERE NOT isfinite(x)) THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'vector contains non-finite values');
            CONTINUE;
        END IF;

        v_dim := array_length(v_vector_arr, 1);
        IF v_dim != p_expected_dim THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object(
                'id', v_entry_id,
                'reason', 'dimension mismatch',
                'expected', p_expected_dim,
                'actual', v_dim
            );
            CONTINUE;
        END IF;

        v_vector := v_vector_arr::vector;

        IF p_force_overwrite THEN
            UPDATE public.knowledge_entries e
            SET
                content_vector = v_vector,
                metadata = e.metadata || COALESCE(v_update->'metadata', '{}'::jsonb)
            FROM public.knowledge_bases kb
            WHERE e.id = v_entry_id
              AND e.kb_id = kb.id
              AND kb.user_id = p_user_id;
        ELSE
            UPDATE public.knowledge_entries e
            SET
                content_vector = v_vector,
                metadata = e.metadata || COALESCE(v_update->'metadata', '{}'::jsonb)
            FROM public.knowledge_bases kb
            WHERE e.id = v_entry_id
              AND e.kb_id = kb.id
              AND kb.user_id = p_user_id
              AND e.content_vector IS NULL;
        END IF;

        IF FOUND THEN
            v_updated := v_updated + 1;
        ELSE
            IF NOT p_force_overwrite AND EXISTS (
                SELECT 1 FROM public.knowledge_entries e
                JOIN public.knowledge_bases kb ON e.kb_id = kb.id
                WHERE e.id = v_entry_id
                  AND kb.user_id = p_user_id
                  AND e.content_vector IS NOT NULL
            ) THEN
                v_already_exists := v_already_exists + 1;
            ELSE
                v_skipped := v_skipped + 1;
                v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'entry not found or not owned');
            END IF;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_updated, v_skipped, v_already_exists, v_errors;
END;
$$;

REVOKE ALL ON FUNCTION public.batch_update_vectors_as_service(jsonb, uuid, integer, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_update_vectors_as_service(jsonb, uuid, integer, boolean) TO authenticated, service_role;
