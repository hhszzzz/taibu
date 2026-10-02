CREATE OR REPLACE FUNCTION public.submit_community_report_and_notify(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.community_reports;
  v_user_id uuid := auth.uid();
  v_post_id uuid;
  v_link text := format('/community/%s', p_target_id);
  v_content text := format('目标类型：%s，原因：%s', p_target_type, p_reason);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.community_reports (
    reporter_id,
    target_type,
    target_id,
    reason,
    description
  )
  VALUES (
    v_user_id,
    p_target_type,
    p_target_id,
    p_reason,
    NULLIF(p_description, '')
  )
  RETURNING *
  INTO v_report;

  IF p_target_type = 'comment' THEN
    SELECT post_id
    INTO v_post_id
    FROM public.community_comments
    WHERE id = p_target_id;

    IF v_post_id IS NOT NULL THEN
      v_link := format('/community/%s', v_post_id);
    END IF;
  END IF;

  IF NULLIF(p_description, '') IS NOT NULL THEN
    v_content := v_content || '，描述：' || p_description;
  END IF;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    content,
    link
  )
  SELECT
    u.id,
    'system',
    '有新的社区举报',
    v_content,
    v_link
  FROM public.users u
  LEFT JOIN public.user_settings s
    ON s.user_id = u.id
  WHERE u.is_admin = true
    AND COALESCE(s.notifications_enabled, true)
    AND COALESCE(s.notify_site, true);

  RETURN jsonb_build_object(
    'status', 'ok',
    'report', to_jsonb(v_report)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_rate_limit_slot_as_admin(
  p_identifier text,
  p_endpoint text,
  p_max_requests integer,
  p_window_ms integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_window interval;
  v_row public.rate_limits;
  v_reset_at timestamptz;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_max_requests <= 0 OR p_window_ms <= 0 THEN
    RAISE EXCEPTION 'invalid rate limit config' USING ERRCODE = '22023';
  END IF;

  v_window := (p_window_ms::text || ' milliseconds')::interval;

  INSERT INTO public.rate_limits (
    identifier,
    endpoint,
    request_count,
    window_start
  )
  VALUES (
    p_identifier,
    p_endpoint,
    1,
    v_now
  )
  ON CONFLICT (identifier, endpoint) DO UPDATE
  SET
    request_count = CASE
      WHEN public.rate_limits.window_start IS NULL
        OR v_now - public.rate_limits.window_start >= v_window THEN 1
      WHEN COALESCE(public.rate_limits.request_count, 0) >= p_max_requests THEN public.rate_limits.request_count
      ELSE COALESCE(public.rate_limits.request_count, 0) + 1
    END,
    window_start = CASE
      WHEN public.rate_limits.window_start IS NULL
        OR v_now - public.rate_limits.window_start >= v_window THEN v_now
      ELSE public.rate_limits.window_start
    END
  RETURNING *
  INTO v_row;

  v_reset_at := COALESCE(v_row.window_start, v_now) + v_window;

  RETURN jsonb_build_object(
    'allowed', COALESCE(v_row.request_count, 0) <= p_max_requests,
    'remaining', GREATEST(p_max_requests - COALESCE(v_row.request_count, 0), 0),
    'reset_at', v_reset_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_scheduled_reminder_delivery_as_service(
  p_reminder_id uuid,
  p_stale_before timestamptz,
  p_notification_title text,
  p_notification_content text,
  p_notification_link text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed public.scheduled_reminders;
  v_claimed_at timestamptz := now();
  v_should_notify boolean := false;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.scheduled_reminders
  SET sent_at = v_claimed_at
  WHERE id = p_reminder_id
    AND sent = false
    AND (sent_at IS NULL OR sent_at <= p_stale_before)
  RETURNING *
  INTO v_claimed;

  IF v_claimed.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_claimed');
  END IF;

  SELECT
    COALESCE(rs.enabled, false)
    AND COALESCE(rs.notify_site, false)
    AND COALESCE(us.notifications_enabled, true)
    AND COALESCE(us.notify_site, true)
  INTO v_should_notify
  FROM (SELECT 1) seed
  LEFT JOIN public.reminder_subscriptions rs
    ON rs.user_id = v_claimed.user_id
   AND rs.reminder_type = v_claimed.reminder_type
  LEFT JOIN public.user_settings us
    ON us.user_id = v_claimed.user_id;

  IF NOT v_should_notify THEN
    UPDATE public.scheduled_reminders
    SET
      sent = true,
      sent_at = v_claimed_at
    WHERE id = v_claimed.id
      AND sent = false
      AND sent_at = v_claimed_at;

    RETURN jsonb_build_object('status', 'skipped');
  END IF;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    content,
    link
  )
  VALUES (
    v_claimed.user_id,
    'system',
    p_notification_title,
    p_notification_content,
    p_notification_link
  );

  UPDATE public.scheduled_reminders
  SET
    sent = true,
    sent_at = v_claimed_at
  WHERE id = v_claimed.id
    AND sent = false
    AND sent_at = v_claimed_at;

  RETURN jsonb_build_object('status', 'sent');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_community_report_and_notify(text, uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION public.consume_rate_limit_slot_as_admin(text, text, integer, integer) FROM public;
REVOKE ALL ON FUNCTION public.process_scheduled_reminder_delivery_as_service(uuid, timestamptz, text, text, text) FROM public;

GRANT EXECUTE ON FUNCTION public.submit_community_report_and_notify(text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit_slot_as_admin(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_scheduled_reminder_delivery_as_service(uuid, timestamptz, text, text, text) TO authenticated;
