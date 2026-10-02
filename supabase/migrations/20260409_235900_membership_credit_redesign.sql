ALTER TABLE public.activation_keys
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.users
  ALTER COLUMN ai_chat_count SET DEFAULT 1;

UPDATE public.users
SET ai_chat_count = COALESCE(ai_chat_count, 1)
WHERE ai_chat_count IS NULL;

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS balance_after integer,
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.credit_transactions
SET type = 'earn'
WHERE type = 'reward';

ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_type_check
  CHECK (type = ANY (ARRAY['earn'::text, 'spend'::text, 'refund'::text]));

ALTER TABLE public.daily_checkins
  DROP COLUMN IF EXISTS streak_days;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS last_credit_restore_at;

DROP TABLE IF EXISTS public.user_levels CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.purchase_links CASCADE;

INSERT INTO public.app_settings (setting_key, setting_value, updated_at)
SELECT 'feature_disabled:credits', setting_value, now()
FROM public.app_settings
WHERE setting_key = 'feature_disabled:orders'
  AND NOT EXISTS (
    SELECT 1
    FROM public.app_settings
    WHERE setting_key = 'feature_disabled:credits'
  );

DELETE FROM public.app_settings
WHERE setting_key = 'feature_disabled:orders';

DROP FUNCTION IF EXISTS public.complete_membership_upgrade_as_service(uuid, text, numeric, integer, integer, timestamptz);
DROP FUNCTION IF EXISTS public.complete_credit_purchase_as_service(uuid, numeric, integer);
DROP FUNCTION IF EXISTS public.restore_ai_chat_count(uuid, integer, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.membership_rank(p_plan_id text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_plan_id
    WHEN 'pro' THEN 2
    WHEN 'plus' THEN 1
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION public.membership_credit_limit(p_plan_id text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_plan_id
    WHEN 'pro' THEN 50
    WHEN 'plus' THEN 20
    ELSE 10
  END
$$;

CREATE OR REPLACE FUNCTION public.record_credit_transaction(
  p_user_id uuid,
  p_amount integer,
  p_type text,
  p_source text,
  p_balance_after integer,
  p_reference_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id uuid;
BEGIN
  INSERT INTO public.credit_transactions (
    user_id,
    amount,
    type,
    source,
    description,
    balance_after,
    reference_type,
    reference_id,
    metadata
  )
  VALUES (
    p_user_id,
    p_amount,
    p_type,
    p_source,
    p_description,
    p_balance_after,
    p_reference_type,
    p_reference_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_transaction_id;

  RETURN v_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_credit_transaction(uuid, integer, text, text, integer, text, text, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_credit_transaction(uuid, integer, text, text, integer, text, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.decrement_ai_chat_count(user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.users
  SET
    ai_chat_count = GREATEST(COALESCE(ai_chat_count, 0) - 1, 0),
    updated_at = now()
  WHERE id = user_id
    AND COALESCE(ai_chat_count, 0) > 0
  RETURNING ai_chat_count INTO new_count;

  IF new_count IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.record_credit_transaction(
    user_id,
    -1,
    'spend',
    'ai_usage',
    new_count,
    'credit_usage',
    NULL,
    'AI 使用消费 1 积分',
    '{}'::jsonb
  );

  RETURN new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_ai_chat_count(user_id uuid, amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF amount IS NULL OR amount <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users
  SET
    ai_chat_count = COALESCE(ai_chat_count, 0) + amount,
    updated_at = now()
  WHERE id = user_id
  RETURNING ai_chat_count INTO new_count;

  IF new_count IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.record_credit_transaction(
    user_id,
    amount,
    'refund',
    'ai_refund',
    new_count,
    'credit_refund',
    NULL,
    format('AI 失败退款 +%s 积分', amount),
    '{}'::jsonb
  );

  RETURN new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_key_as_service(
    p_user_id UUID,
    p_key_code TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    error TEXT,
    key_type TEXT,
    membership_type TEXT,
    credits_amount INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_key activation_keys%ROWTYPE;
    v_current_credits INT;
    v_new_credits INT;
    v_current_membership text;
    v_current_membership_expires_at timestamptz;
    v_effective_membership text;
    v_next_expires_at timestamptz;
    v_now timestamptz := now();
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF p_key_code IS NULL OR length(trim(p_key_code)) = 0 THEN
        RETURN QUERY SELECT false, '激活码不能为空', NULL, NULL, NULL;
        RETURN;
    END IF;

    SELECT * INTO v_key
    FROM public.activation_keys
    WHERE key_code = p_key_code
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, '激活码不存在', NULL, NULL, NULL;
        RETURN;
    END IF;

    IF v_key.is_used THEN
        RETURN QUERY SELECT false, '该激活码已被使用', v_key.key_type, v_key.membership_type, v_key.credits_amount;
        RETURN;
    END IF;

    IF v_key.key_type = 'membership' THEN
        IF v_key.membership_type NOT IN ('plus', 'pro') THEN
            RETURN QUERY SELECT false, '无效的会员类型', v_key.key_type, v_key.membership_type, NULL;
            RETURN;
        END IF;

        SELECT membership, membership_expires_at
        INTO v_current_membership, v_current_membership_expires_at
        FROM public.users
        WHERE id = p_user_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN QUERY SELECT false, '获取用户信息失败', v_key.key_type, v_key.membership_type, NULL;
            RETURN;
        END IF;

        v_effective_membership := CASE
            WHEN v_current_membership IN ('plus', 'pro')
                AND v_current_membership_expires_at IS NOT NULL
                AND v_current_membership_expires_at > v_now
              THEN v_current_membership
            ELSE 'free'
        END;

        IF public.membership_rank(v_effective_membership) > public.membership_rank(v_key.membership_type) THEN
            RETURN QUERY SELECT false, '当前已有更高等级会员', v_key.key_type, v_key.membership_type, NULL;
            RETURN;
        END IF;

        IF public.membership_rank(v_effective_membership) = public.membership_rank(v_key.membership_type)
            AND v_effective_membership <> 'free'
            AND v_current_membership_expires_at IS NOT NULL
            AND v_current_membership_expires_at > v_now THEN
            v_next_expires_at := v_current_membership_expires_at + INTERVAL '30 days';
        ELSE
            v_next_expires_at := v_now + INTERVAL '30 days';
        END IF;

        UPDATE public.users
        SET
            membership = v_key.membership_type,
            membership_expires_at = v_next_expires_at,
            updated_at = now()
        WHERE id = p_user_id;
    ELSE
        IF COALESCE(v_key.credits_amount, 0) <= 0 THEN
            RETURN QUERY SELECT false, '无效的积分数量', v_key.key_type, NULL, NULL;
            RETURN;
        END IF;

        SELECT COALESCE(ai_chat_count, 0)
        INTO v_current_credits
        FROM public.users
        WHERE id = p_user_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN QUERY SELECT false, '获取用户信息失败', v_key.key_type, NULL, NULL;
            RETURN;
        END IF;

        v_new_credits := v_current_credits + COALESCE(v_key.credits_amount, 0);

        UPDATE public.users
        SET
            ai_chat_count = v_new_credits,
            updated_at = now()
        WHERE id = p_user_id;

        PERFORM public.record_credit_transaction(
            p_user_id,
            COALESCE(v_key.credits_amount, 0),
            'earn',
            'activation_key',
            v_new_credits,
            'activation_key',
            v_key.id::text,
            format('激活码充值 +%s 积分', COALESCE(v_key.credits_amount, 0)),
            jsonb_build_object('key_source', COALESCE(v_key.source, 'admin'))
        );
    END IF;

    UPDATE public.activation_keys
    SET
        is_used = true,
        used_by = p_user_id,
        used_at = now()
    WHERE id = v_key.id AND is_used = false;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, '激活失败，请重试', v_key.key_type, v_key.membership_type, v_key.credits_amount;
        RETURN;
    END IF;

    RETURN QUERY SELECT true, NULL, v_key.key_type, v_key.membership_type, v_key.credits_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.perform_daily_checkin_as_service(
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := current_date;
  v_current_credits integer := 0;
  v_new_credits integer := 0;
  v_membership text := 'free';
  v_membership_expires_at timestamptz;
  v_effective_membership text := 'free';
  v_credit_limit integer := 10;
  v_base_reward integer := 1;
  v_reward_credits integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(ai_chat_count, 0),
    COALESCE(membership, 'free'),
    membership_expires_at
  INTO
    v_current_credits,
    v_membership,
    v_membership_expires_at
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'user_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.daily_checkins
    WHERE user_id = p_user_id
      AND checkin_date = v_today
  ) THEN
    RETURN jsonb_build_object(
      'status', 'already_checked_in',
      'reward_credits', 0
    );
  END IF;

  IF v_membership IN ('plus', 'pro')
    AND v_membership_expires_at IS NOT NULL
    AND v_membership_expires_at > now() THEN
    v_effective_membership := v_membership;
  END IF;

  v_credit_limit := public.membership_credit_limit(v_effective_membership);

  IF v_current_credits >= v_credit_limit THEN
    RETURN jsonb_build_object(
      'status', 'credit_cap_reached',
      'reward_credits', 0,
      'credit_limit', v_credit_limit
    );
  END IF;

  v_base_reward := FLOOR(random() * 3)::integer + 1;
  v_reward_credits := CASE v_effective_membership
    WHEN 'pro' THEN v_base_reward * 3
    WHEN 'plus' THEN v_base_reward * 2
    ELSE v_base_reward
  END;
  v_reward_credits := LEAST(v_reward_credits, v_credit_limit - v_current_credits);
  v_new_credits := v_current_credits + v_reward_credits;

  INSERT INTO public.daily_checkins (
    user_id,
    checkin_date,
    reward_credits
  ) VALUES (
    p_user_id,
    v_today,
    v_reward_credits
  );

  UPDATE public.users
  SET
    ai_chat_count = v_new_credits,
    updated_at = now()
  WHERE id = p_user_id;

  PERFORM public.record_credit_transaction(
    p_user_id,
    v_reward_credits,
    'earn',
    'checkin',
    v_new_credits,
    'daily_checkin',
    v_today::text,
    format('每日签到 +%s 积分', v_reward_credits),
    jsonb_build_object('membership', v_effective_membership, 'base_reward', v_base_reward)
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'reward_credits', v_reward_credits,
    'credits', v_new_credits,
    'membership', v_effective_membership,
    'credit_limit', v_credit_limit
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'status', 'already_checked_in',
      'reward_credits', 0
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_linuxdo_membership_as_service(
  p_user_id uuid,
  p_plan_id text,
  p_trust_level integer,
  p_provider_user_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_claim_at timestamptz;
  v_current_membership text;
  v_current_membership_expires_at timestamptz;
  v_effective_membership text := 'free';
  v_next_expires_at timestamptz;
  v_now timestamptz := now();
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_plan_id NOT IN ('plus', 'pro') THEN
    RETURN jsonb_build_object('status', 'invalid_plan');
  END IF;

  SELECT used_at
  INTO v_last_claim_at
  FROM public.activation_keys
  WHERE used_by = p_user_id
    AND key_type = 'membership'
    AND source = 'linuxdo_monthly'
  ORDER BY used_at DESC
  LIMIT 1;

  IF v_last_claim_at IS NOT NULL AND v_last_claim_at > v_now - INTERVAL '30 days' THEN
    RETURN jsonb_build_object(
      'status', 'cooldown',
      'next_available_at', v_last_claim_at + INTERVAL '30 days'
    );
  END IF;

  SELECT membership, membership_expires_at
  INTO v_current_membership, v_current_membership_expires_at
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'user_not_found');
  END IF;

  IF v_current_membership IN ('plus', 'pro')
    AND v_current_membership_expires_at IS NOT NULL
    AND v_current_membership_expires_at > v_now THEN
    v_effective_membership := v_current_membership;
  END IF;

  IF public.membership_rank(v_effective_membership) > public.membership_rank(p_plan_id) THEN
    RETURN jsonb_build_object(
      'status', 'lower_tier_ignored',
      'membership', v_effective_membership,
      'expires_at', v_current_membership_expires_at
    );
  END IF;

  IF public.membership_rank(v_effective_membership) = public.membership_rank(p_plan_id)
    AND v_effective_membership <> 'free'
    AND v_current_membership_expires_at IS NOT NULL
    AND v_current_membership_expires_at > v_now THEN
    v_next_expires_at := v_current_membership_expires_at + INTERVAL '30 days';
  ELSE
    v_next_expires_at := v_now + INTERVAL '30 days';
  END IF;

  INSERT INTO public.activation_keys (
    key_code,
    key_type,
    membership_type,
    is_used,
    used_by,
    used_at,
    created_by,
    source,
    metadata
  )
  VALUES (
    'sk-auto-' || replace(gen_random_uuid()::text, '-', ''),
    'membership',
    p_plan_id,
    true,
    p_user_id,
    v_now,
    p_user_id,
    'linuxdo_monthly',
    jsonb_build_object(
      'trust_level', p_trust_level,
      'provider_user_id', p_provider_user_id
    )
  );

  UPDATE public.users
  SET
    membership = p_plan_id,
    membership_expires_at = v_next_expires_at,
    updated_at = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'membership', p_plan_id,
    'expires_at', v_next_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_linuxdo_user_and_provider(
  p_user_id uuid,
  p_nickname text,
  p_avatar_url text,
  p_provider_user_id text,
  p_provider_email text,
  p_provider_username text,
  p_provider_avatar_url text,
  p_provider_metadata jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_provider_user_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT user_id
  INTO v_existing_provider_user_id
  FROM public.user_oauth_providers
  WHERE provider = 'linuxdo'
    AND provider_user_id = p_provider_user_id
  FOR UPDATE;

  IF v_existing_provider_user_id IS NOT NULL AND v_existing_provider_user_id <> p_user_id THEN
    RETURN jsonb_build_object('status', 'provider_bound_to_other_user');
  END IF;

  INSERT INTO public.users (
    id,
    nickname,
    avatar_url,
    membership,
    ai_chat_count
  )
  VALUES (
    p_user_id,
    p_nickname,
    p_avatar_url,
    'free',
    1
  )
  ON CONFLICT (id) DO UPDATE
  SET
    nickname = EXCLUDED.nickname,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = now();

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
    p_user_id,
    'linuxdo',
    p_provider_user_id,
    p_provider_email,
    p_provider_username,
    p_provider_avatar_url,
    p_provider_metadata
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
    RETURN jsonb_build_object('status', 'provider_bound_to_other_user');
  END IF;

  RETURN jsonb_build_object('status', 'ok');
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
    1
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

REVOKE ALL ON FUNCTION public.perform_daily_checkin_as_service(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.perform_daily_checkin_as_service(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.claim_linuxdo_membership_as_service(uuid, text, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_linuxdo_membership_as_service(uuid, text, integer, text) TO service_role;
