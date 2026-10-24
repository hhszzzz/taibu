-- Required rows and data invariants, applied after the definitions on every
-- db:init run. Existing application data is preserved.

-- The system principal: server-side work runs as this administrator.
INSERT INTO identity.users (id, email, email_verified, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'system@taibu.invalid', true, '系统')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, nickname, membership, ai_chat_count, is_admin)
VALUES ('00000000-0000-4000-8000-000000000001', '系统', 'pro', 999999, true)
ON CONFLICT (id) DO UPDATE SET is_admin = true WHERE public.users.is_admin IS NOT TRUE;

-- Settle unfinished runs whose checkpoint the current runtime cannot execute,
-- acting as the system principal exactly as the Agent worker does.
DO $retire$
DECLARE r public.agent_runs; message jsonb;
  old_claims text := current_setting('request.jwt.claims',true);
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  FOR r IN SELECT * FROM public.agent_runs WHERE status IN ('queued','running','awaiting_input','cancelling')
    AND (coalesce(checkpoint->>'version','')<>'2' OR coalesce(checkpoint#>>'{durable,engine}','')<>'pi-durable/1.4.0') FOR UPDATE LOOP
    UPDATE public.agent_runs SET worker_id='engine-retirement',fence=fence+1,lease_until=now()+interval '60 seconds',status='running'
      WHERE id=r.id RETURNING * INTO r;
    message:=jsonb_set(r.public_message,'{agent}',coalesce(r.public_message->'agent','{}'::jsonb)||jsonb_build_object('error','运行版本已更新，请重新发起任务。'));
    PERFORM public.agent_finish_run(r.id,r.worker_id,r.fence,'failed',r.checkpoint,message);
    UPDATE public.agent_run_commands SET consumed=true,delivery_state='cancelled' WHERE run_id=r.id AND NOT consumed;
  END LOOP;
  PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);
END; $retire$;
