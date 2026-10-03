CREATE OR REPLACE FUNCTION public.perform_daily_checkin_as_service(
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := current_date;
  v_last_checkin date;
  v_last_streak integer := 0;
  v_new_streak integer := 1;
  v_reward_credits integer := 0;
  v_reward_xp integer := 10;
  v_current_level integer := 1;
  v_current_total_xp integer := 0;
  v_new_total_xp integer := 0;
  v_new_level integer := 1;
  v_new_title text := '初学者';
  v_new_level_xp integer := 0;
  v_leveled_up boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'user_not_found');
  END IF;

  SELECT checkin_date, streak_days
  INTO v_last_checkin, v_last_streak
  FROM public.daily_checkins
  WHERE user_id = p_user_id
  ORDER BY checkin_date DESC
  LIMIT 1;

  IF v_last_checkin = v_today THEN
    RETURN jsonb_build_object(
      'status', 'already_checked_in',
      'streak_days', COALESCE(v_last_streak, 0),
      'reward_credits', 0,
      'reward_xp', 0,
      'leveled_up', false
    );
  END IF;

  IF v_last_checkin = v_today - 1 THEN
    v_new_streak := COALESCE(v_last_streak, 0) + 1;
  END IF;

  IF v_new_streak > 0 AND mod(v_new_streak, 30) = 0 THEN
    v_reward_credits := v_reward_credits + 5;
  END IF;

  IF v_new_streak > 0 AND mod(v_new_streak, 7) = 0 THEN
    v_reward_credits := v_reward_credits + 1;
  END IF;

  IF v_new_streak >= 30 THEN
    v_reward_xp := 11;
  END IF;

  INSERT INTO public.user_levels (
    user_id,
    level,
    experience,
    total_experience,
    title
  )
  VALUES (
    p_user_id,
    1,
    0,
    0,
    '初学者'
  )
  ON CONFLICT (user_id) DO NOTHING;

  SELECT level, total_experience
  INTO v_current_level, v_current_total_xp
  FROM public.user_levels
  WHERE user_id = p_user_id
  FOR UPDATE;

  v_new_total_xp := COALESCE(v_current_total_xp, 0) + v_reward_xp;

  IF v_new_total_xp >= 12700 THEN
    v_new_level := 8;
    v_new_title := '传奇';
    v_new_level_xp := v_new_total_xp - 12700;
  ELSIF v_new_total_xp >= 6300 THEN
    v_new_level := 7;
    v_new_title := '宗师';
    v_new_level_xp := v_new_total_xp - 6300;
  ELSIF v_new_total_xp >= 3100 THEN
    v_new_level := 6;
    v_new_title := '大师';
    v_new_level_xp := v_new_total_xp - 3100;
  ELSIF v_new_total_xp >= 1500 THEN
    v_new_level := 5;
    v_new_title := '专家';
    v_new_level_xp := v_new_total_xp - 1500;
  ELSIF v_new_total_xp >= 700 THEN
    v_new_level := 4;
    v_new_title := '熟练者';
    v_new_level_xp := v_new_total_xp - 700;
  ELSIF v_new_total_xp >= 300 THEN
    v_new_level := 3;
    v_new_title := '学徒';
    v_new_level_xp := v_new_total_xp - 300;
  ELSIF v_new_total_xp >= 100 THEN
    v_new_level := 2;
    v_new_title := '见习者';
    v_new_level_xp := v_new_total_xp - 100;
  ELSE
    v_new_level := 1;
    v_new_title := '初学者';
    v_new_level_xp := v_new_total_xp;
  END IF;

  v_leveled_up := v_new_level > COALESCE(v_current_level, 1);

  IF v_leveled_up THEN
    v_reward_credits := v_reward_credits + 1;
  END IF;

  INSERT INTO public.daily_checkins (
    user_id,
    checkin_date,
    streak_days,
    reward_credits
  )
  VALUES (
    p_user_id,
    v_today,
    v_new_streak,
    v_reward_credits
  );

  UPDATE public.user_levels
  SET
    level = v_new_level,
    experience = v_new_level_xp,
    total_experience = v_new_total_xp,
    title = v_new_title,
    updated_at = now()
  WHERE user_id = p_user_id;

  IF v_reward_credits > 0 THEN
    INSERT INTO public.credit_transactions (
      user_id,
      amount,
      type,
      source,
      description
    )
    VALUES (
      p_user_id,
      v_reward_credits,
      'earn',
      'checkin',
      CASE
        WHEN v_leveled_up THEN format('连续签到第%s天 + 升级奖励', v_new_streak)
        ELSE format('连续签到第%s天', v_new_streak)
      END
    );

    UPDATE public.users
    SET ai_chat_count = COALESCE(ai_chat_count, 0) + v_reward_credits
    WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'streak_days', v_new_streak,
    'reward_credits', v_reward_credits,
    'reward_xp', v_reward_xp,
    'leveled_up', v_leveled_up
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'status', 'already_checked_in',
      'streak_days', COALESCE(v_last_streak, 0),
      'reward_credits', 0,
      'reward_xp', 0,
      'leveled_up', false
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_bazi_case_profile_as_service(
  p_user_id uuid,
  p_chart_id uuid,
  p_master_review jsonb,
  p_owner_feedback jsonb,
  p_events jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_typeof(p_events), 'null') <> 'array' THEN
    RAISE EXCEPTION 'events must be an array' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bazi_charts
    WHERE id = p_chart_id
      AND user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('status', 'chart_not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bazi_case_profile'), hashtext(p_chart_id::text));

  INSERT INTO public.bazi_case_profiles (
    user_id,
    bazi_chart_id,
    master_review,
    owner_feedback,
    updated_at
  )
  VALUES (
    p_user_id,
    p_chart_id,
    p_master_review,
    p_owner_feedback,
    now()
  )
  ON CONFLICT (bazi_chart_id) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    master_review = EXCLUDED.master_review,
    owner_feedback = EXCLUDED.owner_feedback,
    updated_at = now()
  RETURNING id
  INTO v_profile_id;

  DELETE FROM public.bazi_case_events
  WHERE profile_id = v_profile_id
    AND user_id = p_user_id;

  INSERT INTO public.bazi_case_events (
    profile_id,
    user_id,
    bazi_chart_id,
    event_date,
    category,
    title,
    detail
  )
  SELECT
    v_profile_id,
    p_user_id,
    p_chart_id,
    event_date,
    category,
    title,
    NULLIF(detail, '')
  FROM jsonb_to_recordset(p_events) AS event_row(
    event_date date,
    category text,
    title text,
    detail text
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'profile_id', v_profile_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_replace_source_entries(
  p_kb_id uuid,
  p_source_type text,
  p_source_id text,
  p_entries jsonb,
  p_archive boolean DEFAULT false,
  p_user_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id uuid;
  v_rows integer := 0;
BEGIN
  IF COALESCE(jsonb_typeof(p_entries), 'null') <> 'array' THEN
    RAISE EXCEPTION 'entries must be an array' USING ERRCODE = '22023';
  END IF;

  IF auth.role() = 'service_role' THEN
    v_actor_user_id := p_user_id;
    IF v_actor_user_id IS NULL THEN
      RAISE EXCEPTION 'user required for service role' USING ERRCODE = '22023';
    END IF;
  ELSIF auth.uid() IS NOT NULL THEN
    v_actor_user_id := auth.uid();
  ELSE
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.knowledge_bases
    WHERE id = p_kb_id
      AND user_id = v_actor_user_id
  ) THEN
    RAISE EXCEPTION 'knowledge base not found' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_kb_id::text),
    hashtext(p_source_type || ':' || p_source_id)
  );

  DELETE FROM public.knowledge_entries
  WHERE kb_id = p_kb_id
    AND source_type = p_source_type
    AND source_id = p_source_id
    AND chunk_index >= jsonb_array_length(p_entries);

  INSERT INTO public.knowledge_entries (
    kb_id,
    content,
    content_vector,
    source_type,
    source_id,
    chunk_index,
    metadata
  )
  SELECT
    p_kb_id,
    entry_row.content,
    NULL,
    p_source_type,
    p_source_id,
    entry_row.chunk_index,
    COALESCE(entry_row.metadata, '{}'::jsonb)
  FROM jsonb_to_recordset(p_entries) AS entry_row(
    content text,
    chunk_index integer,
    metadata jsonb
  )
  ON CONFLICT (kb_id, source_type, source_id, chunk_index) DO UPDATE
  SET
    content = EXCLUDED.content,
    content_vector = NULL,
    metadata = EXCLUDED.metadata;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF p_archive THEN
    INSERT INTO public.archived_sources (
      user_id,
      kb_id,
      source_type,
      source_id
    )
    VALUES (
      v_actor_user_id,
      p_kb_id,
      p_source_type,
      p_source_id
    )
    ON CONFLICT (source_type, source_id, kb_id) DO UPDATE
    SET user_id = EXCLUDED.user_id;
  END IF;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_unarchive_source_as_service(
  p_user_id uuid,
  p_kb_id uuid,
  p_source_type text,
  p_source_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.knowledge_bases
    WHERE id = p_kb_id
      AND user_id = p_user_id
  ) THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_kb_id::text),
    hashtext(p_source_type || ':' || p_source_id)
  );

  DELETE FROM public.knowledge_entries
  WHERE kb_id = p_kb_id
    AND source_type = p_source_type
    AND source_id = p_source_id;

  DELETE FROM public.archived_sources
  WHERE user_id = p_user_id
    AND kb_id = p_kb_id
    AND source_type = p_source_type
    AND source_id = p_source_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_membership_upgrade_as_service(
  p_user_id uuid,
  p_plan_id text,
  p_amount numeric,
  p_initial_credits integer,
  p_credit_limit integer,
  p_expires_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_credits integer := 0;
  v_next_credits integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(ai_chat_count, 0)
  INTO v_current_credits
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'user_not_found');
  END IF;

  v_next_credits := GREATEST(
    v_current_credits,
    LEAST(v_current_credits + p_initial_credits, p_credit_limit)
  );

  INSERT INTO public.orders (
    user_id,
    product_type,
    amount,
    status,
    payment_method,
    paid_at
  )
  VALUES (
    p_user_id,
    p_plan_id,
    p_amount,
    'paid',
    'simulated',
    now()
  );

  UPDATE public.users
  SET
    membership = p_plan_id,
    membership_expires_at = p_expires_at,
    ai_chat_count = v_next_credits,
    last_credit_restore_at = now(),
    updated_at = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'credits', v_next_credits,
    'expires_at', p_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_credit_purchase_as_service(
  p_user_id uuid,
  p_amount numeric,
  p_credit_count integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_credits integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(ai_chat_count, 0)
  INTO v_new_credits
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'user_not_found');
  END IF;

  INSERT INTO public.orders (
    user_id,
    product_type,
    amount,
    status,
    payment_method,
    paid_at
  )
  VALUES (
    p_user_id,
    'pay_per_use',
    p_amount,
    'paid',
    'simulated',
    now()
  );

  UPDATE public.users
  SET ai_chat_count = COALESCE(ai_chat_count, 0) + p_credit_count
  WHERE id = p_user_id
  RETURNING ai_chat_count
  INTO v_new_credits;

  RETURN jsonb_build_object(
    'status', 'ok',
    'credits', v_new_credits
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_promote_ai_model_binding(
  p_model_id text,
  p_source_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ai_model_gateway_bindings
    WHERE id::text = p_source_id
      AND model_id::text = p_model_id
  ) THEN
    RETURN false;
  END IF;

  WITH ordered AS (
    SELECT
      id,
      row_number() OVER (
        ORDER BY
          CASE WHEN id::text = p_source_id THEN 0 ELSE 1 END,
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

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_conversation_graph_as_service(
  p_conversation_id text,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id
  INTO v_conversation_id
  FROM public.conversations
  WHERE id::text = p_conversation_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF v_conversation_id IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.knowledge_entries
  WHERE source_type = 'conversation'
    AND source_id = p_conversation_id;

  DELETE FROM public.archived_sources
  WHERE source_type = 'conversation'
    AND source_id = p_conversation_id
    AND user_id = p_user_id;

  DELETE FROM public.conversations
  WHERE id = v_conversation_id
    AND user_id = p_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_mbti_history_item_and_conversation_as_service(
  p_history_id text,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT conversation_id
  INTO v_conversation_id
  FROM public.mbti_readings
  WHERE id::text = p_history_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  DELETE FROM public.mbti_readings
  WHERE id::text = p_history_id
    AND user_id = p_user_id;

  IF v_conversation_id IS NOT NULL THEN
    PERFORM public.delete_conversation_graph_as_service(v_conversation_id::text, p_user_id);
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_analysis_conversation_with_history_as_service(
  p_user_id uuid,
  p_source_type text,
  p_source_data jsonb,
  p_title text,
  p_personality text,
  p_messages jsonb,
  p_history_type text,
  p_history_payload jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_yongshen_targets text[];
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_typeof(p_messages), 'null') <> 'array' THEN
    RAISE EXCEPTION 'messages must be an array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.conversations (
    user_id,
    source_type,
    source_data,
    title,
    personality,
    messages
  )
  VALUES (
    p_user_id,
    p_source_type,
    COALESCE(p_source_data, '{}'::jsonb),
    p_title,
    COALESCE(NULLIF(p_personality, ''), 'general'),
    '[]'::jsonb
  )
  RETURNING id
  INTO v_conversation_id;

  PERFORM public.replace_conversation_messages(v_conversation_id, p_messages);

  CASE p_history_type
    WHEN 'mbti' THEN
      IF NULLIF(p_history_payload->>'reading_id', '') IS NOT NULL THEN
        UPDATE public.mbti_readings
        SET conversation_id = v_conversation_id
        WHERE id::text = p_history_payload->>'reading_id'
          AND user_id = p_user_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'mbti reading not found';
        END IF;
      ELSE
        INSERT INTO public.mbti_readings (
          user_id,
          mbti_type,
          scores,
          percentages,
          conversation_id
        )
        VALUES (
          p_user_id,
          p_history_payload->>'mbti_type',
          p_history_payload->'scores',
          p_history_payload->'percentages',
          v_conversation_id
        );
      END IF;

    WHEN 'tarot' THEN
      IF NULLIF(p_history_payload->>'reading_id', '') IS NOT NULL THEN
        UPDATE public.tarot_readings
        SET
          conversation_id = v_conversation_id,
          metadata = CASE
            WHEN p_history_payload ? 'metadata'
              AND jsonb_typeof(p_history_payload->'metadata') <> 'null'
              THEN p_history_payload->'metadata'
            ELSE metadata
          END
        WHERE id::text = p_history_payload->>'reading_id'
          AND user_id = p_user_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'tarot reading not found';
        END IF;
      ELSE
        INSERT INTO public.tarot_readings (
          user_id,
          spread_id,
          question,
          cards,
          conversation_id,
          metadata
        )
        VALUES (
          p_user_id,
          p_history_payload->>'spread_id',
          NULLIF(p_history_payload->>'question', ''),
          COALESCE(p_history_payload->'cards', '[]'::jsonb),
          v_conversation_id,
          COALESCE(p_history_payload->'metadata', '{}'::jsonb)
        );
      END IF;

    WHEN 'hepan' THEN
      IF NULLIF(p_history_payload->>'chart_id', '') IS NOT NULL THEN
        UPDATE public.hepan_charts
        SET conversation_id = v_conversation_id
        WHERE id::text = p_history_payload->>'chart_id'
          AND user_id = p_user_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'hepan chart not found';
        END IF;
      ELSE
        INSERT INTO public.hepan_charts (
          user_id,
          type,
          person1_name,
          person1_birth,
          person2_name,
          person2_birth,
          compatibility_score,
          conversation_id,
          result_data
        )
        VALUES (
          p_user_id,
          p_history_payload->>'type',
          p_history_payload->>'person1_name',
          COALESCE(p_history_payload->'person1_birth', '{}'::jsonb),
          p_history_payload->>'person2_name',
          COALESCE(p_history_payload->'person2_birth', '{}'::jsonb),
          CASE
            WHEN p_history_payload ? 'compatibility_score'
              THEN (p_history_payload->>'compatibility_score')::integer
            ELSE NULL
          END,
          v_conversation_id,
          p_history_payload->'result_data'
        );
      END IF;

    WHEN 'palm' THEN
      INSERT INTO public.palm_readings (
        user_id,
        analysis_type,
        hand_type,
        conversation_id
      )
      VALUES (
        p_user_id,
        COALESCE(NULLIF(p_history_payload->>'analysis_type', ''), 'full'),
        COALESCE(NULLIF(p_history_payload->>'hand_type', ''), 'left'),
        v_conversation_id
      );

    WHEN 'face' THEN
      INSERT INTO public.face_readings (
        user_id,
        analysis_type,
        conversation_id
      )
      VALUES (
        p_user_id,
        COALESCE(NULLIF(p_history_payload->>'analysis_type', ''), 'full'),
        v_conversation_id
      );

    WHEN 'qimen' THEN
      IF NULLIF(p_history_payload->>'chart_id', '') IS NOT NULL THEN
        UPDATE public.qimen_charts
        SET conversation_id = v_conversation_id
        WHERE id::text = p_history_payload->>'chart_id'
          AND user_id = p_user_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'qimen chart not found';
        END IF;
      ELSE
        INSERT INTO public.qimen_charts (
          user_id,
          question,
          chart_time,
          year,
          month,
          day,
          hour,
          minute,
          timezone,
          dun_type,
          ju_number,
          pan_type,
          ju_method,
          zhi_fu_ji_gong,
          conversation_id
        )
        VALUES (
          p_user_id,
          NULLIF(p_history_payload->>'question', ''),
          (p_history_payload->>'chart_time')::timestamptz,
          (p_history_payload->>'year')::integer,
          (p_history_payload->>'month')::integer,
          (p_history_payload->>'day')::integer,
          (p_history_payload->>'hour')::integer,
          (p_history_payload->>'minute')::integer,
          p_history_payload->>'timezone',
          p_history_payload->>'dun_type',
          (p_history_payload->>'ju_number')::integer,
          p_history_payload->>'pan_type',
          p_history_payload->>'ju_method',
          p_history_payload->>'zhi_fu_ji_gong',
          v_conversation_id
        );
      END IF;

    WHEN 'daliuren' THEN
      IF NULLIF(p_history_payload->>'divination_id', '') IS NOT NULL THEN
        UPDATE public.daliuren_divinations
        SET conversation_id = v_conversation_id
        WHERE id::text = p_history_payload->>'divination_id'
          AND user_id = p_user_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'daliuren divination not found';
        END IF;
      END IF;

    WHEN 'liuyao' THEN
      v_yongshen_targets := ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(p_history_payload->'yongshen_targets', '[]'::jsonb))
      );

      IF NULLIF(p_history_payload->>'divination_id', '') IS NOT NULL THEN
        UPDATE public.liuyao_divinations
        SET
          conversation_id = v_conversation_id,
          yongshen_targets = CASE
            WHEN array_length(v_yongshen_targets, 1) IS NULL THEN NULL
            ELSE v_yongshen_targets
          END
        WHERE id::text = p_history_payload->>'divination_id'
          AND user_id = p_user_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'liuyao divination not found';
        END IF;
      ELSE
        INSERT INTO public.liuyao_divinations (
          user_id,
          question,
          yongshen_targets,
          hexagram_code,
          changed_hexagram_code,
          changed_lines,
          conversation_id
        )
        VALUES (
          p_user_id,
          COALESCE(p_history_payload->>'question', ''),
          CASE
            WHEN array_length(v_yongshen_targets, 1) IS NULL THEN NULL
            ELSE v_yongshen_targets
          END,
          p_history_payload->>'hexagram_code',
          NULLIF(p_history_payload->>'changed_hexagram_code', ''),
          p_history_payload->'changed_lines',
          v_conversation_id
        );
      END IF;

    ELSE
      RAISE EXCEPTION 'invalid history type' USING ERRCODE = '22023';
  END CASE;

  RETURN v_conversation_id::text;
END;
$$;

REVOKE ALL ON FUNCTION public.perform_daily_checkin_as_service(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_bazi_case_profile_as_service(uuid, uuid, jsonb, jsonb, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.kb_replace_source_entries(uuid, text, text, jsonb, boolean, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.kb_unarchive_source_as_service(uuid, uuid, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_membership_upgrade_as_service(uuid, text, numeric, integer, integer, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_credit_purchase_as_service(uuid, numeric, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_promote_ai_model_binding(text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_conversation_graph_as_service(text, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_mbti_history_item_and_conversation_as_service(text, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_analysis_conversation_with_history_as_service(uuid, text, jsonb, text, text, jsonb, text, jsonb) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.perform_daily_checkin_as_service(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_bazi_case_profile_as_service(uuid, uuid, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.kb_replace_source_entries(uuid, text, text, jsonb, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_replace_source_entries(uuid, text, text, jsonb, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kb_unarchive_source_as_service(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_membership_upgrade_as_service(uuid, text, numeric, integer, integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_credit_purchase_as_service(uuid, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_promote_ai_model_binding(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_conversation_graph_as_service(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_mbti_history_item_and_conversation_as_service(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_analysis_conversation_with_history_as_service(uuid, text, jsonb, text, text, jsonb, text, jsonb) TO service_role;
