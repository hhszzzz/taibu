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

  -- Serialize per-user monthly claims so the cooldown check and grant write
  -- happen inside the same critical section.
  PERFORM pg_advisory_xact_lock(hashtextextended('linuxdo_monthly_claim:' || p_user_id::text, 0));

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

REVOKE ALL ON FUNCTION public.claim_linuxdo_membership_as_service(uuid, text, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_linuxdo_membership_as_service(uuid, text, integer, text) TO service_role;
