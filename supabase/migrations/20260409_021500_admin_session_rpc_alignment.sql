CREATE OR REPLACE FUNCTION public.replace_conversation_messages(
  p_conversation_id uuid,
  p_messages jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_typeof(p_messages), 'null') <> 'array' THEN
    RAISE EXCEPTION 'messages must be an array' USING ERRCODE = '22023';
  END IF;

  SELECT user_id
  INTO v_owner
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF auth.uid() IS NOT NULL
    AND auth.uid() <> v_owner
    AND NOT public.is_admin_user()
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversations
  SET messages = COALESCE(p_messages, '[]'::jsonb),
      updated_at = now()
  WHERE id = p_conversation_id;

  DELETE FROM public.conversation_messages
  WHERE conversation_id = p_conversation_id;

  INSERT INTO public.conversation_messages (
    conversation_id,
    sequence,
    message_id,
    role,
    content,
    metadata,
    created_at
  )
  SELECT
    p_conversation_id,
    elements.ordinality::integer - 1,
    COALESCE(elements.value->>'id', gen_random_uuid()::text),
    COALESCE(elements.value->>'role', 'assistant'),
    COALESCE(elements.value->>'content', ''),
    (elements.value - 'id' - 'role' - 'content' - 'createdAt'),
    COALESCE(NULLIF(elements.value->>'createdAt', '')::timestamptz, now())
  FROM jsonb_array_elements(COALESCE(p_messages, '[]'::jsonb)) WITH ORDINALITY AS elements(value, ordinality);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_conversation_messages(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.replace_conversation_messages(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_conversation_messages(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.create_conversation_with_messages(
  p_user_id uuid,
  p_title text,
  p_personality text DEFAULT NULL,
  p_source_type text DEFAULT NULL,
  p_source_data jsonb DEFAULT NULL,
  p_messages jsonb DEFAULT '[]'::jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_conversation_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin_user() AND v_actor_id <> p_user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_typeof(p_messages), 'null') <> 'array' THEN
    RAISE EXCEPTION 'messages must be an array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.conversations (
    user_id,
    title,
    personality,
    source_type,
    source_data,
    messages
  )
  VALUES (
    p_user_id,
    COALESCE(NULLIF(p_title, ''), '新对话'),
    COALESCE(NULLIF(p_personality, ''), 'general'),
    p_source_type,
    p_source_data,
    '[]'::jsonb
  )
  RETURNING id
  INTO v_conversation_id;

  PERFORM public.replace_conversation_messages(v_conversation_id, COALESCE(p_messages, '[]'::jsonb));

  RETURN v_conversation_id::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_conversation_with_messages(
  p_conversation_id uuid,
  p_title text DEFAULT NULL,
  p_title_present boolean DEFAULT false,
  p_personality text DEFAULT NULL,
  p_personality_present boolean DEFAULT false,
  p_messages jsonb DEFAULT NULL,
  p_messages_present boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT user_id
  INTO v_owner
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF NOT public.is_admin_user() AND v_actor_id <> v_owner THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_messages_present AND COALESCE(jsonb_typeof(p_messages), 'null') <> 'array' THEN
    RAISE EXCEPTION 'messages must be an array' USING ERRCODE = '22023';
  END IF;

  UPDATE public.conversations
  SET
    title = CASE WHEN p_title_present THEN p_title ELSE title END,
    personality = CASE WHEN p_personality_present THEN p_personality ELSE personality END,
    updated_at = now()
  WHERE id = p_conversation_id;

  IF p_messages_present THEN
    PERFORM public.replace_conversation_messages(p_conversation_id, COALESCE(p_messages, '[]'::jsonb));
  END IF;

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

REVOKE ALL ON FUNCTION public.create_conversation_with_messages(uuid, text, text, text, jsonb, jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.update_conversation_with_messages(uuid, text, boolean, text, boolean, jsonb, boolean) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.create_conversation_with_messages(uuid, text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_conversation_with_messages(uuid, text, text, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_conversation_with_messages(uuid, text, boolean, text, boolean, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_conversation_with_messages(uuid, text, boolean, text, boolean, jsonb, boolean) TO service_role;

DO $$
DECLARE
  v_signature text;
  v_definition text;
BEGIN
  FOR v_signature, v_definition IN
    SELECT
      p.oid::regprocedure::text,
      pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n
      ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'perform_daily_checkin_as_service',
        'save_bazi_case_profile_as_service',
        'kb_unarchive_source_as_service',
        'complete_membership_upgrade_as_service',
        'complete_credit_purchase_as_service',
        'admin_promote_ai_model_binding',
        'delete_conversation_graph_as_service',
        'delete_mbti_history_item_and_conversation_as_service',
        'create_analysis_conversation_with_history_as_service',
        'admin_create_ai_model_with_binding',
        'admin_update_ai_model_and_cleanup_bindings',
        'sync_linuxdo_user_and_provider'
      ])
  LOOP
    IF strpos(v_definition, 'IF auth.role() <> ''service_role'' THEN') = 0 THEN
      RAISE EXCEPTION 'target function % no longer matches expected service_role guard', v_signature;
    END IF;

    v_definition := replace(
      v_definition,
      'IF auth.role() <> ''service_role'' THEN',
      'IF NOT public.is_admin_user() THEN'
    );

    EXECUTE v_definition;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;
END;
$$;
