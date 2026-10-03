WITH ranked_scheduled_reminders AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, reminder_type, scheduled_for
      ORDER BY
        sent DESC,
        sent_at DESC NULLS LAST,
        created_at ASC,
        id ASC
    ) AS rn
  FROM public.scheduled_reminders
)
DELETE FROM public.scheduled_reminders
WHERE id IN (
  SELECT id
  FROM ranked_scheduled_reminders
  WHERE rn > 1
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduled_reminders_user_id_reminder_type_scheduled_for_key'
      AND conrelid = 'public.scheduled_reminders'::regclass
  ) THEN
    ALTER TABLE public.scheduled_reminders
      ADD CONSTRAINT scheduled_reminders_user_id_reminder_type_scheduled_for_key
      UNIQUE (user_id, reminder_type, scheduled_for);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_reminder_if_absent_as_service(
  p_user_id uuid,
  p_reminder_type text,
  p_scheduled_for timestamptz,
  p_content jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_id uuid;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.scheduled_reminders (
    user_id,
    reminder_type,
    scheduled_for,
    content
  )
  VALUES (
    p_user_id,
    p_reminder_type,
    p_scheduled_for,
    p_content
  )
  ON CONFLICT (user_id, reminder_type, scheduled_for) DO NOTHING
  RETURNING id
  INTO v_inserted_id;

  RETURN v_inserted_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_ai_model_binding(
  p_model_id text,
  p_source_key text,
  p_model_id_override text DEFAULT NULL,
  p_reasoning_model_id text DEFAULT NULL,
  p_is_enabled boolean DEFAULT true,
  p_priority integer DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model_id text;
  v_model_key text;
  v_gateway_id text;
  v_priority integer;
  v_normalized_model_id_override text;
  v_binding public.ai_model_gateway_bindings;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    id::text,
    model_key
  INTO
    v_model_id,
    v_model_key
  FROM public.ai_models
  WHERE id::text = p_model_id
  FOR UPDATE;

  IF v_model_id IS NULL THEN
    RETURN jsonb_build_object('status', 'model_not_found');
  END IF;

  SELECT id::text
  INTO v_gateway_id
  FROM public.ai_gateways
  WHERE gateway_key = p_source_key
  FOR UPDATE;

  IF v_gateway_id IS NULL THEN
    RETURN jsonb_build_object('status', 'gateway_not_found');
  END IF;

  SELECT COALESCE(MAX(priority), -1) + 1
  INTO v_priority
  FROM public.ai_model_gateway_bindings
  WHERE model_id::text = v_model_id;

  v_normalized_model_id_override := NULLIF(BTRIM(COALESCE(p_model_id_override, '')), '');
  IF v_normalized_model_id_override = v_model_key THEN
    v_normalized_model_id_override := NULL;
  END IF;

  INSERT INTO public.ai_model_gateway_bindings (
    model_id,
    gateway_id,
    model_id_override,
    reasoning_model_id,
    is_enabled,
    priority,
    notes
  )
  VALUES (
    v_model_id::uuid,
    v_gateway_id::uuid,
    v_normalized_model_id_override,
    NULLIF(BTRIM(COALESCE(p_reasoning_model_id, '')), ''),
    COALESCE(p_is_enabled, true),
    COALESCE(p_priority, v_priority),
    p_notes
  )
  RETURNING *
  INTO v_binding;

  RETURN jsonb_build_object(
    'status', 'ok',
    'binding', to_jsonb(v_binding)
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'conflict');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_ai_model_binding(
  p_model_id text,
  p_source_id text,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_activate boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_binding public.ai_model_gateway_bindings;
  v_binding_id uuid;
  v_gateway_key text;
  v_gateway_enabled boolean;
  v_model_key text;
  v_normalized_model_id_override text;
  v_next_enabled boolean;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT model_key
  INTO v_model_key
  FROM public.ai_models
  WHERE id::text = p_model_id
  FOR UPDATE;

  IF v_model_key IS NULL THEN
    RETURN jsonb_build_object('status', 'model_not_found');
  END IF;

  SELECT
    binding.id,
    gateway.gateway_key,
    gateway.is_enabled
  INTO
    v_binding_id,
    v_gateway_key,
    v_gateway_enabled
  FROM public.ai_model_gateway_bindings AS binding
  LEFT JOIN public.ai_gateways AS gateway
    ON gateway.id = binding.gateway_id
  WHERE binding.id::text = p_source_id
    AND binding.model_id::text = p_model_id
  FOR UPDATE OF binding;

  IF v_binding_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT *
  INTO v_binding
  FROM public.ai_model_gateway_bindings
  WHERE id = v_binding_id;

  IF v_gateway_key IS NULL OR v_gateway_key NOT IN ('newapi', 'octopus') THEN
    RETURN jsonb_build_object('status', 'unsupported_source');
  END IF;

  IF p_patch ? 'model_id_override' THEN
    IF jsonb_typeof(p_patch->'model_id_override') = 'null' THEN
      v_normalized_model_id_override := NULL;
    ELSE
      v_normalized_model_id_override := NULLIF(BTRIM(p_patch->>'model_id_override'), '');
      IF v_normalized_model_id_override = v_model_key THEN
        v_normalized_model_id_override := NULL;
      END IF;
    END IF;
  END IF;

  v_next_enabled := CASE
    WHEN p_patch ? 'is_enabled' THEN COALESCE((p_patch->>'is_enabled')::boolean, false)
    ELSE COALESCE(v_binding.is_enabled, true)
  END;

  IF p_activate AND (NOT v_next_enabled OR COALESCE(v_gateway_enabled, true) = false) THEN
    RETURN jsonb_build_object('status', 'disabled_cannot_activate');
  END IF;

  UPDATE public.ai_model_gateway_bindings
  SET
    model_id_override = CASE
      WHEN p_patch ? 'model_id_override' THEN v_normalized_model_id_override
      ELSE model_id_override
    END,
    reasoning_model_id = CASE
      WHEN p_patch ? 'reasoning_model_id' THEN
        CASE
          WHEN jsonb_typeof(p_patch->'reasoning_model_id') = 'null' THEN NULL
          ELSE NULLIF(BTRIM(p_patch->>'reasoning_model_id'), '')
        END
      ELSE reasoning_model_id
    END,
    is_enabled = CASE
      WHEN p_patch ? 'is_enabled' THEN COALESCE((p_patch->>'is_enabled')::boolean, false)
      ELSE is_enabled
    END,
    priority = CASE
      WHEN p_patch ? 'priority' THEN (p_patch->>'priority')::integer
      ELSE priority
    END,
    notes = CASE
      WHEN p_patch ? 'notes' THEN
        CASE
          WHEN jsonb_typeof(p_patch->'notes') = 'null' THEN NULL
          ELSE p_patch->>'notes'
        END
      ELSE notes
    END,
    updated_at = now()
  WHERE id = v_binding.id
  RETURNING *
  INTO v_binding;

  IF p_activate THEN
    WITH ordered AS (
      SELECT
        id,
        row_number() OVER (
          ORDER BY
            CASE WHEN id = v_binding.id THEN 0 ELSE 1 END,
            priority ASC,
            id ASC
        ) - 1 AS new_priority
      FROM public.ai_model_gateway_bindings
      WHERE model_id::text = p_model_id
    )
    UPDATE public.ai_model_gateway_bindings AS binding
    SET priority = ordered.new_priority
    FROM ordered
    WHERE binding.id = ordered.id;

    SELECT *
    INTO v_binding
    FROM public.ai_model_gateway_bindings
    WHERE id = v_binding.id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'binding', to_jsonb(v_binding)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_knowledge_base_with_limit(
  p_user_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_weight text DEFAULT 'normal',
  p_limit integer DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_count integer;
  v_kb public.knowledge_bases;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_limit <= 0 THEN
    RAISE EXCEPTION 'invalid limit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('knowledge-base:%s', p_user_id), 0));

  SELECT COUNT(*)
  INTO v_existing_count
  FROM public.knowledge_bases
  WHERE user_id = p_user_id;

  IF v_existing_count >= p_limit THEN
    RETURN jsonb_build_object('status', 'limit_reached');
  END IF;

  INSERT INTO public.knowledge_bases (
    user_id,
    name,
    description,
    weight
  )
  VALUES (
    p_user_id,
    p_name,
    p_description,
    p_weight
  )
  RETURNING *
  INTO v_kb;

  RETURN jsonb_build_object(
    'status', 'ok',
    'knowledge_base', to_jsonb(v_kb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_community_vote(
  p_target_type text,
  p_target_id uuid,
  p_vote_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing public.community_votes;
  v_vote text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_target_type NOT IN ('post', 'comment') THEN
    RAISE EXCEPTION 'invalid target_type' USING ERRCODE = '22023';
  END IF;

  IF p_vote_type NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'invalid vote_type' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('community-vote:%s:%s:%s', v_user_id, p_target_type, p_target_id), 0)
  );

  SELECT *
  INTO v_existing
  FROM public.community_votes
  WHERE user_id = v_user_id
    AND target_type = p_target_type
    AND target_id = p_target_id
  FOR UPDATE;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.community_votes (
      user_id,
      target_type,
      target_id,
      vote_type
    )
    VALUES (
      v_user_id,
      p_target_type,
      p_target_id,
      p_vote_type
    )
    RETURNING vote_type
    INTO v_vote;
  ELSIF v_existing.vote_type = p_vote_type THEN
    DELETE FROM public.community_votes
    WHERE id = v_existing.id;

    v_vote := NULL;
  ELSE
    UPDATE public.community_votes
    SET vote_type = p_vote_type
    WHERE id = v_existing.id
    RETURNING vote_type
    INTO v_vote;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'vote', v_vote
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_ming_record_pin(
  p_record_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record public.ming_records;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ming_records
  SET
    is_pinned = NOT COALESCE(is_pinned, false),
    updated_at = now()
  WHERE id = p_record_id
    AND user_id = auth.uid()
  RETURNING *
  INTO v_record;

  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'record', to_jsonb(v_record)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_auth_user_profile_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nickname text;
  v_avatar_url text;
  v_linuxdo_sub text;
  v_linuxdo_email text;
  v_linuxdo_username text;
  v_provider_metadata jsonb;
BEGIN
  v_nickname := COALESCE(NEW.raw_user_meta_data->>'nickname', '命理爱好者');
  v_avatar_url := NEW.raw_user_meta_data->>'avatar_url';

  INSERT INTO public.users (
    id,
    nickname,
    avatar_url,
    membership,
    ai_chat_count
  )
  VALUES (
    NEW.id,
    v_nickname,
    v_avatar_url,
    'free',
    3
  )
  ON CONFLICT (id) DO UPDATE
  SET
    nickname = EXCLUDED.nickname,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = now();

  v_linuxdo_sub := NULLIF(BTRIM(COALESCE(NEW.raw_user_meta_data->>'linuxdo_sub', '')), '');
  IF v_linuxdo_sub IS NULL THEN
    RETURN NEW;
  END IF;

  v_linuxdo_email := NULLIF(BTRIM(COALESCE(NEW.raw_user_meta_data->>'linuxdo_email', NEW.email, '')), '');
  v_linuxdo_username := NULLIF(BTRIM(COALESCE(NEW.raw_user_meta_data->>'linuxdo_username', '')), '');
  v_provider_metadata := COALESCE(
    NEW.raw_user_meta_data->'linuxdo_provider_metadata',
    jsonb_build_object(
      'sub', v_linuxdo_sub,
      'email', v_linuxdo_email,
      'preferred_username', v_linuxdo_username,
      'picture', v_avatar_url
    )
  );

  INSERT INTO public.user_oauth_providers (
    user_id,
    provider,
    provider_user_id,
    provider_email,
    provider_username,
    provider_avatar_url,
    provider_metadata
  )
  VALUES (
    NEW.id,
    'linuxdo',
    v_linuxdo_sub,
    v_linuxdo_email,
    v_linuxdo_username,
    v_avatar_url,
    v_provider_metadata
  )
  ON CONFLICT (provider, provider_user_id) DO UPDATE
  SET
    provider_email = EXCLUDED.provider_email,
    provider_username = EXCLUDED.provider_username,
    provider_avatar_url = EXCLUDED.provider_avatar_url,
    provider_metadata = EXCLUDED.provider_metadata,
    updated_at = now()
  WHERE public.user_oauth_providers.user_id = EXCLUDED.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'linuxdo provider is already bound to another user' USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_profile_synced ON auth.users;

CREATE TRIGGER on_auth_user_profile_synced
AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_auth_user_profile_sync();

REVOKE ALL ON FUNCTION public.schedule_reminder_if_absent_as_service(uuid, text, timestamptz, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_create_ai_model_binding(text, text, text, text, boolean, integer, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_ai_model_binding(text, text, jsonb, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_knowledge_base_with_limit(uuid, text, text, text, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.toggle_community_vote(text, uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.toggle_ming_record_pin(uuid) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.schedule_reminder_if_absent_as_service(uuid, text, timestamptz, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_ai_model_binding(text, text, text, text, boolean, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_ai_model_binding(text, text, jsonb, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_knowledge_base_with_limit(uuid, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_community_vote(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_ming_record_pin(uuid) TO authenticated;
