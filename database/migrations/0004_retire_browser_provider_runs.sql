-- Agent tasks still open on the old single browser provider (input.customProvider) cannot resume: custom models are
-- now connections. They finish as failed with a note the way seed.sql retires runs of an older engine, acting as the
-- system principal with the run's lease, so the staged key is dropped and the conversation shows the task stopped.
DO $retire$
DECLARE r public.agent_runs; message jsonb;
  old_claims text := current_setting('request.jwt.claims', true);
BEGIN
  IF to_regclass('public.agent_runs') IS NULL
    OR to_regprocedure('public.agent_finish_run(uuid,text,bigint,text,jsonb,jsonb)') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO identity.users (id, email, email_verified, name)
  VALUES ('00000000-0000-4000-8000-000000000001', 'system@taibu.invalid', true, '系统')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, nickname, is_admin)
  VALUES ('00000000-0000-4000-8000-000000000001', '系统', true)
  ON CONFLICT (id) DO UPDATE SET is_admin = true WHERE public.users.is_admin IS NOT TRUE;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  FOR r IN SELECT * FROM public.agent_runs WHERE input ? 'customProvider'
    AND status IN ('queued', 'running', 'awaiting_input', 'cancelling') FOR UPDATE LOOP
    UPDATE public.agent_runs SET worker_id = 'provider-retirement', fence = fence + 1, lease_until = now() + interval '60 seconds', status = 'running'
      WHERE id = r.id RETURNING * INTO r;
    message := jsonb_set(r.public_message, '{agent}', coalesce(r.public_message -> 'agent', '{}'::jsonb)
      || jsonb_build_object('error', '自定义模型已改为连接方式，请在「设置 → 自定义模型」重新添加后再发起任务。'));
    PERFORM public.agent_finish_run(r.id, r.worker_id, r.fence, 'failed', r.checkpoint, message);
    UPDATE public.agent_run_commands SET consumed = true, delivery_state = 'cancelled' WHERE run_id = r.id AND NOT consumed;
  END LOOP;
  PERFORM set_config('request.jwt.claims', coalesce(old_claims, ''), true);
END; $retire$;
