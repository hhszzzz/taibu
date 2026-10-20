BEGIN;

-- Pi Durable 1.3.0 replaces 1.1.0. Its tool tasks are version 2 (model-issued or
-- nested), and code mode, nested calls and deferred tools add task and agent
-- documents a 1.1.0 worker cannot read. Only the current engine executes.
CREATE OR REPLACE FUNCTION public.agent_worker_heartbeat(p_worker_id text,p_engine text DEFAULT 'pi-durable/1.3.0')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.agent_require_admin();
  IF p_engine IS DISTINCT FROM 'pi-durable/1.3.0' THEN
    RAISE EXCEPTION 'AGENT_ENGINE_UNSUPPORTED' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.agent_workers(id,heartbeat_at,engine) VALUES(p_worker_id,now(),p_engine)
    ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at,engine=excluded.engine;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_claim_run(p_worker_id text) RETURNS public.agent_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.agent_runs;
BEGIN
  PERFORM public.agent_require_admin();
  IF NOT EXISTS(SELECT 1 FROM public.agent_workers WHERE id=p_worker_id AND engine='pi-durable/1.3.0') THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.agent_runs
    WHERE (status='queued' OR (status IN ('running','cancelling') AND lease_until<now()))
      AND checkpoint->>'version'='2' AND checkpoint#>>'{durable,engine}'='pi-durable/1.3.0'
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.agent_runs SET status=CASE WHEN cancel_requested THEN 'cancelling' ELSE 'running' END,
    worker_id=p_worker_id,fence=fence+1,lease_until=now()+interval '60 seconds',updated_at=now()
    WHERE id=r.id RETURNING * INTO r;
  PERFORM public.agent_emit(r.id,'claimed');
  SELECT * INTO r FROM public.agent_runs WHERE id=r.id;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.agent_worker_heartbeat(text,text),public.agent_claim_run(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.agent_worker_heartbeat(text,text),public.agent_claim_run(text) TO authenticated,service_role;

-- Swap the admission guard the current-engine migration installed; any other
-- definition is unreviewed and stops the migration.
DO $migration$
DECLARE definition text;
  old_guard text := 'IF coalesce(p_checkpoint->>''version'','''')<>''2'' OR coalesce(p_checkpoint#>>''{durable,engine}'','''')<>''pi-durable/1.1.0'' THEN RAISE EXCEPTION ''AGENT_ENGINE_UNSUPPORTED'' USING ERRCODE=''22023''; END IF;';
  new_guard text := 'IF coalesce(p_checkpoint->>''version'','''')<>''2'' OR coalesce(p_checkpoint#>>''{durable,engine}'','''')<>''pi-durable/1.3.0'' THEN RAISE EXCEPTION ''AGENT_ENGINE_UNSUPPORTED'' USING ERRCODE=''22023''; END IF;';
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.agent_create_run(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure) INTO definition;
  IF position(new_guard IN definition)=0 THEN
    IF position(old_guard IN definition)=0 THEN RAISE EXCEPTION 'Review agent_create_run before installing the pi-durable/1.3.0 guard'; END IF;
    EXECUTE replace(definition,old_guard,new_guard);
  END IF;
END; $migration$;

-- Fence old owners and settle all unfinished 1.1.0 tasks once, through the
-- existing settlement: empty failed work is refunded, partial replies keep the
-- charge. Completed history and artifacts stay readable.
DO $retire$
DECLARE r public.agent_runs; message jsonb;
  old_claims text := current_setting('request.jwt.claims',true);
  old_role text := current_setting('request.jwt.claim.role',true);
BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  FOR r IN SELECT * FROM public.agent_runs WHERE status IN ('queued','running','awaiting_input','cancelling')
    AND (coalesce(checkpoint->>'version','')<>'2' OR coalesce(checkpoint#>>'{durable,engine}','')<>'pi-durable/1.3.0') FOR UPDATE LOOP
    UPDATE public.agent_runs SET worker_id='engine-retirement',fence=fence+1,lease_until=now()+interval '60 seconds',status='running'
      WHERE id=r.id RETURNING * INTO r;
    message:=jsonb_set(r.public_message,'{agent}',coalesce(r.public_message->'agent','{}'::jsonb)||jsonb_build_object('error','运行版本已更新，请重新发起任务。'));
    PERFORM public.agent_finish_run(r.id,r.worker_id,r.fence,'failed',r.checkpoint,message,NULL);
    UPDATE public.agent_run_commands SET consumed=true,delivery_state='cancelled' WHERE run_id=r.id AND NOT consumed;
  END LOOP;
  PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);
  PERFORM set_config('request.jwt.claim.role',coalesce(old_role,''),true);
END; $retire$;

NOTIFY pgrst, 'reload schema';
COMMIT;
