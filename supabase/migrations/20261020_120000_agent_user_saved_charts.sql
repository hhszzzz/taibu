-- Saving an Agent chart to the chart library is the user's choice on the board,
-- through the result pages' own save endpoint; the model no longer selects
-- results for the task's settlement to save. agent_finish_run stops saving
-- charts and drops p_record (unused since 20261007_100000); agent_cache_tool
-- stops storing a chart payload; the artifact columns that only these two
-- functions wrote are dropped. Settlement, command, refund and message rules
-- are unchanged. Earlier answers keep their artifact parts and chart links in
-- their messages; the saved charts themselves are untouched.
BEGIN;

DROP FUNCTION public.agent_finish_run(uuid,text,bigint,text,jsonb,jsonb,jsonb);
CREATE FUNCTION public.agent_finish_run(p_run_id uuid,p_worker_id text,p_fence bigint,p_status text,p_checkpoint jsonb,p_message jsonb)
RETURNS public.agent_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.agent_runs; final_status text;
BEGIN
  r:=public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  IF p_status NOT IN ('completed','awaiting_input','failed','cancelled') THEN RAISE EXCEPTION 'AGENT_INVALID_STATUS'; END IF;
  final_status:=CASE WHEN r.cancel_requested THEN 'cancelled' ELSE p_status END;
  IF final_status IN ('completed','awaiting_input') AND EXISTS(SELECT 1 FROM public.agent_run_commands WHERE run_id=p_run_id AND NOT consumed AND (final_status<>'awaiting_input' OR (mode='reply' AND NOT durable_admitted))) THEN
    final_status:='queued';
  END IF;
  IF final_status IN ('failed','cancelled') AND r.billing='charged' AND coalesce(btrim(p_message->>'content'),'')='' AND r.record_id IS NULL THEN
    IF public.increment_ai_chat_count(r.user_id,1) IS NULL THEN RAISE EXCEPTION 'AGENT_REFUND_FAILED'; END IF;
    r.billing:='refunded';
  END IF;
  p_message:=jsonb_set(p_message,'{agent,status}',to_jsonb(final_status));
  UPDATE public.agent_runs SET status=final_status,checkpoint=p_checkpoint,public_message=p_message,billing=r.billing,
    lease_until=NULL,worker_id=NULL,updated_at=now() WHERE id=p_run_id RETURNING * INTO r;
  IF final_status IN ('completed','failed','cancelled') THEN DELETE FROM public.agent_run_credentials WHERE run_id=p_run_id; END IF;
  PERFORM public.agent_emit(p_run_id,final_status);
  PERFORM public.agent_sync_message(p_run_id);
  SELECT * INTO r FROM public.agent_runs WHERE id=p_run_id;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.agent_finish_run(uuid,text,bigint,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.agent_finish_run(uuid,text,bigint,text,jsonb,jsonb) TO authenticated,service_role;

DROP FUNCTION public.agent_cache_tool(uuid,text,bigint,text,text,text,jsonb,jsonb,jsonb);
CREATE FUNCTION public.agent_cache_tool(p_run_id uuid,p_worker_id text,p_fence bigint,p_call_id text,p_tool_name text,p_kind text,p_args jsonb,p_result jsonb)
RETURNS public.agent_run_artifacts LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.agent_run_artifacts;
BEGIN
  PERFORM public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  INSERT INTO public.agent_run_artifacts(run_id,call_id,tool_name,kind,args,result)
    VALUES(p_run_id,p_call_id,p_tool_name,p_kind,p_args,p_result) ON CONFLICT(run_id,call_id) DO NOTHING;
  SELECT * INTO STRICT a FROM public.agent_run_artifacts WHERE run_id=p_run_id AND call_id=p_call_id;
  IF a.tool_name<>p_tool_name OR a.args IS DISTINCT FROM p_args OR a.kind<>p_kind THEN RAISE EXCEPTION 'AGENT_TOOL_CALL_MISMATCH'; END IF;
  RETURN a;
END;
$$;
REVOKE ALL ON FUNCTION public.agent_cache_tool(uuid,text,bigint,text,text,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.agent_cache_tool(uuid,text,bigint,text,text,text,jsonb,jsonb) TO authenticated,service_role;

-- No index, constraint or policy uses these columns.
ALTER TABLE public.agent_run_artifacts DROP COLUMN chart_payload, DROP COLUMN chart_id, DROP COLUMN chart_type;

NOTIFY pgrst, 'reload schema';
COMMIT;
