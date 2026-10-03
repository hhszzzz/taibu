DO $$
DECLARE
  v_signature text;
  v_definition text;
  v_rewritten text;
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
        'decrement_ai_chat_count',
        'increment_ai_chat_count',
        'activate_key_as_service',
        'perform_daily_checkin_as_service',
        'claim_linuxdo_membership_as_service',
        'batch_update_vectors_as_service'
      ])
  LOOP
    IF strpos(v_definition, 'IF auth.role() <> ''service_role'' THEN') = 0
      AND strpos(v_definition, 'IF auth.role() != ''service_role'' THEN') = 0 THEN
      RAISE EXCEPTION 'target function % no longer matches expected service_role guard', v_signature;
    END IF;

    IF strpos(v_definition, 'IF auth.role() != ''service_role'' THEN') > 0 THEN
      v_rewritten := regexp_replace(
        v_definition,
        'IF auth\.role\(\) != ''service_role'' THEN\s+RAISE EXCEPTION ''Unauthorized'';\s+END IF;',
        $replacement$
IF auth.role() != 'service_role' THEN
    IF NOT public.is_admin_user() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
END IF;
$replacement$
      );
    ELSE
      v_rewritten := regexp_replace(
        v_definition,
        'IF auth\.role\(\) <> ''service_role'' THEN\s+RAISE EXCEPTION ''forbidden'' USING ERRCODE = ''42501'';\s+END IF;',
        $replacement$
IF auth.role() <> 'service_role' THEN
    IF NOT public.is_admin_user() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
END IF;
$replacement$
      );
    END IF;

    IF v_rewritten = v_definition THEN
      RAISE EXCEPTION 'failed to rewrite service-role guard for %', v_signature;
    END IF;

    EXECUTE v_rewritten;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.record_credit_transaction(uuid, integer, text, text, integer, text, text, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_credit_transaction(uuid, integer, text, text, integer, text, text, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.decrement_ai_chat_count(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_ai_chat_count(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.increment_ai_chat_count(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_ai_chat_count(uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.activate_key_as_service(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_key_as_service(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.perform_daily_checkin_as_service(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.perform_daily_checkin_as_service(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_linuxdo_membership_as_service(uuid, text, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_linuxdo_membership_as_service(uuid, text, integer, text) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n
      ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid::regprocedure::text = 'batch_update_vectors_as_service(jsonb,integer,boolean,uuid)'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.batch_update_vectors_as_service(jsonb, integer, boolean, uuid) FROM public, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.batch_update_vectors_as_service(jsonb, integer, boolean, uuid) TO authenticated, service_role';
  END IF;
END;
$$;
