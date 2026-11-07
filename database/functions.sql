-- Functions and views, maintained directly as PostgreSQL SQL. scripts/db/init.mjs
-- replaces them in place and drops any function or view no longer declared here.

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog'
    AS $$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid
$$;

CREATE OR REPLACE FUNCTION identity.handle_user_created() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.users (id, nickname, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.name), ''), '命理爱好者'),
    NEW.image
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_find_users_by_email(p_query text, p_limit integer DEFAULT 20) RETURNS TABLE(user_id uuid, email text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'identity'
    AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Only admin can read auth user emails' USING ERRCODE = '42501';
  END IF;

  -- Prefix match on the stored lowercase address, exact match first; LIKE wildcards in the query are literal.
  RETURN QUERY
  SELECT au.id, au.email::text
  FROM identity.users au
  WHERE au.email LIKE replace(replace(replace(lower(btrim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ORDER BY au.email = lower(btrim(p_query)) DESC, au.email
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_auth_user_emails(p_user_ids uuid[]) RETURNS TABLE(user_id uuid, email text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'identity'
    AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Only admin can read auth user emails' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT au.id, au.email::text
  FROM identity.users au
  WHERE au.id = ANY (p_user_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_admin_task_log(p_run_id uuid, p_after bigint DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.agent_require_admin();
  IF p_after<0 THEN RAISE EXCEPTION 'AGENT_DURABLE_CURSOR_INVALID' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('sequence',c.sequence,'at',c.created_at,'writes',c.writes) ORDER BY c.sequence),'[]')
    INTO result
    FROM (
      SELECT d.sequence,d.created_at,coalesce((
          SELECT jsonb_agg(kept.write ORDER BY kept.n)
          FROM (
            SELECT items.n,CASE items.w->>'type'
              WHEN 'task' THEN items.w #- '{value,memos}'
              WHEN 'entry' THEN (
                SELECT jsonb_build_object('type','entry','value',jsonb_build_object(
                    'id',items.w#>'{value,id}','conversationId',items.w#>'{value,conversationId}','kind',items.w#>'{value,kind}',
                    'model',jsonb_build_array(jsonb_build_object('role','assistant','content',
                      jsonb_agg(jsonb_build_object('type','toolCall','id',p.part->'id','name',p.part->'name') ORDER BY m.i,p.j)))))
                FROM jsonb_array_elements(CASE jsonb_typeof(items.w#>'{value,model}') WHEN 'array' THEN items.w#>'{value,model}' ELSE '[]'::jsonb END) WITH ORDINALITY AS m(msg,i)
                CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN m.msg->>'role'='assistant' AND jsonb_typeof(m.msg->'content')='array' THEN m.msg->'content' ELSE '[]'::jsonb END) WITH ORDINALITY AS p(part,j)
                WHERE p.part->>'type'='toolCall'
                HAVING count(*)>0)
              ELSE items.w
            END AS write
            FROM jsonb_array_elements(d.writes) WITH ORDINALITY AS items(w,n)
            WHERE items.w->>'type' IN ('conversation','task','submission','entry')
          ) kept
          WHERE kept.write IS NOT NULL
        ),'[]'::jsonb) AS writes
      FROM public.agent_durable_commits d
      WHERE d.run_id=p_run_id AND d.sequence>p_after
      ORDER BY d.sequence
      LIMIT 200
    ) c;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_archive_chart_owned(p_user_id uuid, p_type text, p_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE v_table text; v_owned boolean;
BEGIN
  v_table:=CASE p_type
    WHEN 'bazi_chart' THEN 'bazi_charts' WHEN 'ziwei_chart' THEN 'ziwei_charts' WHEN 'tarot_reading' THEN 'tarot_readings'
    WHEN 'liuyao_divination' THEN 'liuyao_divinations' WHEN 'mbti_reading' THEN 'mbti_readings' WHEN 'hepan_chart' THEN 'hepan_charts'
    WHEN 'face_reading' THEN 'face_readings' WHEN 'palm_reading' THEN 'palm_readings' WHEN 'qimen_chart' THEN 'qimen_charts'
    WHEN 'daliuren_divination' THEN 'daliuren_divinations' WHEN 'meihua_divination' THEN 'meihua_divinations'
    WHEN 'xiaoliuren_divination' THEN 'xiaoliuren_divinations' END;
  IF v_table IS NULL OR p_id IS NULL THEN RETURN false; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND user_id=$2)',v_table) INTO v_owned USING p_id,p_user_id;
  RETURN v_owned;
END;
$_$;

CREATE OR REPLACE FUNCTION public.agent_archive_entry_id(p_run_id uuid, p_call_id text) RETURNS uuid
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT md5(p_run_id::text||':'||p_call_id)::uuid;
$$;


CREATE OR REPLACE FUNCTION public.agent_archive_event(p_run public.agent_runs, p_id uuid, p_chart_type text, p_chart_id uuid, p_event_date date, p_category text, p_title text, p_detail text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_profile uuid;
BEGIN
  IF p_event_date IS NULL OR length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 80 OR length(coalesce(p_detail,''))>500
    OR p_category IS NULL OR p_category NOT IN ('事业','学业','财富','婚姻','健康','六亲','其他') THEN
    RAISE EXCEPTION 'AGENT_ARCHIVE_ENTRY_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_chart_type IS NOT NULL AND NOT public.agent_archive_chart_owned(p_run.user_id,p_chart_type,p_chart_id) THEN
    RAISE EXCEPTION 'AGENT_ARCHIVE_CHART_NOT_FOUND' USING ERRCODE='P0002';
  END IF;
  IF p_chart_type='bazi_chart' THEN
    PERFORM pg_advisory_xact_lock(hashtext('bazi_case_profile'),hashtext(p_chart_id::text));
    INSERT INTO public.bazi_case_profiles(user_id,bazi_chart_id) VALUES(p_run.user_id,p_chart_id) ON CONFLICT(bazi_chart_id) DO NOTHING;
    SELECT id INTO STRICT v_profile FROM public.bazi_case_profiles WHERE bazi_chart_id=p_chart_id AND user_id=p_run.user_id;
    INSERT INTO public.bazi_case_events(id,profile_id,user_id,bazi_chart_id,event_date,category,title,detail,source_run_id)
      VALUES(p_id,v_profile,p_run.user_id,p_chart_id,p_event_date,p_category,btrim(p_title),nullif(btrim(coalesce(p_detail,'')),''),p_run.id)
      ON CONFLICT(id) DO NOTHING;
    RETURN jsonb_build_object('target','case_event','id',p_id);
  END IF;
  INSERT INTO public.ming_records(id,user_id,title,content,category,tags,event_date,related_chart_type,related_chart_id,source_run_id)
    VALUES(p_id,p_run.user_id,btrim(p_title),nullif(btrim(coalesce(p_detail,'')),''),'event',ARRAY[p_category],p_event_date,p_chart_type,
      CASE WHEN p_chart_type IS NULL THEN NULL ELSE p_chart_id END,p_run.id)
    ON CONFLICT(id) DO NOTHING;
  RETURN jsonb_build_object('target','record','id',p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_archive_record_edited() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.source_run_id IS NOT DISTINCT FROM OLD.source_run_id
    AND (NEW.title,NEW.content,NEW.category,NEW.event_date) IS DISTINCT FROM (OLD.title,OLD.content,OLD.category,OLD.event_date) THEN
    NEW.source_run_id:=NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_archive_source_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.agent_runs WHERE id=NEW.source_run_id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'AGENT_ARCHIVE_SOURCE_OWNER' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_cache_tool(p_run_id uuid, p_worker_id text, p_fence bigint, p_call_id text, p_tool_name text, p_kind text, p_args jsonb, p_result jsonb) RETURNS public.agent_run_artifacts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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

CREATE OR REPLACE FUNCTION public.agent_cancel_pending_commands() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.cancel_requested OR NEW.status IN ('cancelled','failed') THEN
    UPDATE public.agent_run_commands SET consumed=true,delivery_state='cancelled',revision=revision+1 WHERE run_id=NEW.id AND (delivery_state='pending' OR (NEW.status IN ('cancelled','failed') AND delivery_state='claimed' AND NOT durable_admitted));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_cancel_run(p_run_id uuid) RETURNS public.agent_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs;
BEGIN
  SELECT * INTO r FROM public.agent_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR (r.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_user()) THEN RAISE EXCEPTION 'AGENT_RUN_NOT_FOUND' USING ERRCODE='42501'; END IF;
  IF r.status IN ('completed','failed','cancelled') THEN RETURN r; END IF;
  UPDATE public.agent_runs SET cancel_requested=true,status=CASE WHEN status IN ('queued','awaiting_input') THEN 'queued' ELSE 'cancelling' END WHERE id=p_run_id RETURNING * INTO r;
  PERFORM public.agent_emit(p_run_id,'cancel_requested');
  SELECT * INTO r FROM public.agent_runs WHERE id=p_run_id;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_change_command(p_run_id uuid, p_sequence bigint, p_revision integer, p_action text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS public.agent_run_commands
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs; cmd public.agent_run_commands;
BEGIN
  SELECT * INTO r FROM public.agent_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR r.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'AGENT_RUN_NOT_FOUND' USING ERRCODE='42501'; END IF;
  SELECT * INTO cmd FROM public.agent_run_commands WHERE run_id=p_run_id AND sequence=p_sequence FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_COMMAND_NOT_FOUND'; END IF;
  IF cmd.delivery_state<>'pending' OR cmd.revision<>p_revision OR r.cancel_requested OR r.status NOT IN ('queued','running','awaiting_input') THEN RAISE EXCEPTION 'AGENT_COMMAND_LOCKED' USING ERRCODE='40001'; END IF;
  IF p_action='edit' THEN
    IF coalesce(btrim(p_payload->>'content'),'')='' OR length(p_payload->>'content')>32000 THEN RAISE EXCEPTION 'AGENT_INVALID_MESSAGE'; END IF;
    cmd.message:=jsonb_set(cmd.message,'{content}',to_jsonb(p_payload->>'content'));
  ELSIF p_action='withdraw' THEN cmd.delivery_state:='cancelled'; cmd.consumed:=true;
  ELSIF p_action='order' THEN
    IF jsonb_typeof(p_payload->'sortOrder')<>'number' OR abs((p_payload->>'sortOrder')::numeric)>9007199254740991 THEN RAISE EXCEPTION 'AGENT_INVALID_ORDER'; END IF;
    cmd.sort_order:=(p_payload->>'sortOrder')::bigint;
  ELSIF p_action='promote' THEN
    IF cmd.mode='reply' THEN RAISE EXCEPTION 'AGENT_QUESTION_REPLY_LOCKED'; END IF;
    cmd.mode:='steer'; SELECT coalesce(min(sort_order),0)-1024 INTO cmd.sort_order FROM public.agent_run_commands WHERE run_id=p_run_id;
  ELSE RAISE EXCEPTION 'AGENT_INVALID_ACTION'; END IF;
  UPDATE public.agent_run_commands SET message=cmd.message,mode=cmd.mode,delivery_state=cmd.delivery_state,consumed=cmd.consumed,sort_order=cmd.sort_order,revision=revision+1 WHERE sequence=p_sequence RETURNING * INTO cmd;
  PERFORM public.agent_emit(p_run_id,'queue_changed');
  RETURN cmd;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_checkpoint(p_run_id uuid, p_worker_id text, p_fence bigint, p_checkpoint jsonb, p_message jsonb, p_event jsonb, p_command bigint DEFAULT NULL::bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  UPDATE public.agent_runs SET checkpoint=p_checkpoint,public_message=p_message,updated_at=now() WHERE id=p_run_id;
  IF p_command IS NOT NULL THEN UPDATE public.agent_run_commands SET consumed=true WHERE run_id=p_run_id AND sequence=p_command; END IF;
  PERFORM public.agent_emit(p_run_id,coalesce(p_event->>'type','checkpoint'),p_event);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_claim_command(p_run_id uuid, p_worker_id text, p_fence bigint, p_sequence bigint) RETURNS public.agent_run_commands
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs; cmd public.agent_run_commands; messages jsonb; previous_write text;
BEGIN
  r:=public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  IF r.cancel_requested THEN RETURN NULL; END IF;
  SELECT * INTO cmd FROM public.agent_run_commands WHERE run_id=p_run_id AND sequence=p_sequence FOR UPDATE;
  IF NOT FOUND OR cmd.delivery_state NOT IN ('pending','claimed') THEN RETURN NULL; END IF;
  IF cmd.delivery_state='pending' THEN UPDATE public.agent_run_commands SET delivery_state='claimed',revision=revision+1 WHERE sequence=p_sequence RETURNING * INTO cmd; END IF;
  SELECT coalesce(c.messages,'[]') INTO messages FROM public.conversations c WHERE c.id=r.conversation_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(messages) m WHERE m->>'id'=cmd.message->>'id') THEN
    previous_write:=current_setting('taibu.agent_write',true); PERFORM set_config('taibu.agent_write','true',true);
    PERFORM public.replace_conversation_messages(r.conversation_id,messages||jsonb_build_array(cmd.message));
    PERFORM set_config('taibu.agent_write',coalesce(previous_write,''),true);
  END IF;
  PERFORM public.agent_emit(p_run_id,'command_claimed');
  RETURN cmd;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_claim_run(p_worker_id text) RETURNS public.agent_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs;
BEGIN
  PERFORM public.agent_require_admin();
  IF NOT EXISTS(SELECT 1 FROM public.agent_workers WHERE id=p_worker_id AND engine='pi-durable/1.5.0') THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.agent_runs
    WHERE (status='queued' OR (status IN ('running','cancelling') AND lease_until<now()))
      AND checkpoint->>'version'='2' AND checkpoint#>>'{durable,engine}'='pi-durable/1.5.0'
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

CREATE OR REPLACE FUNCTION public.agent_command_delivery_state() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.delivery_state<>'cancelled' THEN
    IF NEW.consumed THEN NEW.delivery_state:='consumed'; ELSIF NEW.durable_admitted THEN NEW.delivery_state:='admitted'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_create_run(p_id uuid, p_user_id uuid, p_conversation_id uuid, p_request_id text, p_request_hash text, p_input jsonb, p_checkpoint jsonb, p_message jsonb, p_credential jsonb, p_billing text) RETURNS public.agent_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  r public.agent_runs; c public.conversations; messages jsonb;
  anchor_position bigint; anchor_message jsonb; old_answer jsonb; versions jsonb;
  version_index integer; version_snapshot jsonb; tail_position bigint; previous_write text;
BEGIN
  PERFORM public.agent_require_admin();
  IF coalesce(p_checkpoint->>'version','')<>'2' OR coalesce(p_checkpoint#>>'{durable,engine}','')<>'pi-durable/1.5.0' THEN RAISE EXCEPTION 'AGENT_ENGINE_UNSUPPORTED' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id FOR UPDATE;
  IF NOT FOUND OR c.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'AGENT_CONVERSATION_NOT_FOUND' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.agent_runs WHERE user_id=p_user_id AND request_id=p_request_id;
  IF FOUND THEN
    IF r.request_hash<>p_request_hash THEN RAISE EXCEPTION 'AGENT_REQUEST_MISMATCH' USING ERRCODE='22023'; END IF;
    RETURN r;
  END IF;
  IF EXISTS(SELECT 1 FROM public.agent_runs WHERE conversation_id=p_conversation_id AND status IN ('queued','running','awaiting_input','cancelling')) THEN
    RAISE EXCEPTION 'AGENT_CONVERSATION_BUSY' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.agent_runs(id,user_id,conversation_id,request_id,request_hash,input,checkpoint,public_message,billing)
    VALUES(p_id,p_user_id,p_conversation_id,p_request_id,p_request_hash,p_input,p_checkpoint,p_message,p_billing) RETURNING * INTO r;
  IF p_credential IS NOT NULL THEN INSERT INTO public.agent_run_credentials VALUES(p_id,p_credential); END IF;
  messages:=coalesce(c.messages,'[]');
  IF p_input->>'replaceFromMessageId' IS NOT NULL THEN
    SELECT n INTO anchor_position FROM jsonb_array_elements(messages) WITH ORDINALITY t(m,n) WHERE m->>'id'=p_input->>'replaceFromMessageId' AND m->>'role'='user';
    IF anchor_position IS NULL THEN RAISE EXCEPTION 'AGENT_EDIT_ANCHOR_NOT_FOUND'; END IF;
    anchor_message:=messages->(anchor_position::integer-1);
    old_answer:=messages->anchor_position::integer;
    tail_position:=anchor_position;
    IF old_answer->>'role'='assistant' THEN tail_position:=anchor_position+1; ELSE old_answer:=NULL; END IF;
    versions:=CASE WHEN jsonb_typeof(anchor_message->'versions')='array' THEN anchor_message->'versions' ELSE '[]'::jsonb END;
    version_index:=jsonb_array_length(versions)-1;
    IF coalesce(anchor_message->>'currentVersionIndex','') ~ '^[0-9]{1,9}$' THEN
      IF (anchor_message->>'currentVersionIndex')::integer < jsonb_array_length(versions) THEN
        version_index:=(anchor_message->>'currentVersionIndex')::integer;
      END IF;
    END IF;
    version_snapshot:=CASE WHEN jsonb_typeof(versions->version_index)='object' THEN versions->version_index ELSE '{}'::jsonb END;
    version_snapshot:=version_snapshot||jsonb_build_object(
      'userContent',anchor_message->>'content','attachments',anchor_message->'attachments','mentions',anchor_message->'mentions',
      'aiContent',coalesce(old_answer->>'content',''),'aiAgent',old_answer->'agent','aiMetadata',old_answer->'metadata',
      'createdAt',coalesce(old_answer->>'createdAt',anchor_message->>'createdAt'),
      'subsequentMessages',coalesce((SELECT jsonb_agg(m ORDER BY n) FROM jsonb_array_elements(messages) WITH ORDINALITY t(m,n) WHERE n>tail_position),'[]'));
    IF version_index<0 THEN
      versions:=jsonb_build_array(version_snapshot); version_index:=0;
    ELSE
      versions:=jsonb_set(versions,ARRAY[version_index::text],version_snapshot);
    END IF;
    p_input:=jsonb_set(p_input,'{userMessage}',(p_input->'userMessage')||jsonb_build_object('versions',versions,'currentVersionIndex',version_index));
    UPDATE public.agent_runs SET input=p_input WHERE id=p_id;
    SELECT coalesce(jsonb_agg(m ORDER BY n),'[]') INTO messages FROM jsonb_array_elements(messages) WITH ORDINALITY t(m,n) WHERE n<anchor_position;
  END IF;
  messages:=messages||jsonb_build_array(p_input->'userMessage',p_message);
  previous_write:=current_setting('taibu.agent_write',true);
  PERFORM set_config('taibu.agent_write','true',true);
  PERFORM public.replace_conversation_messages(p_conversation_id,messages);
  PERFORM set_config('taibu.agent_write',coalesce(previous_write,''),true);
  PERFORM public.agent_emit(p_id,'queued');
  SELECT * INTO r FROM public.agent_runs WHERE id=p_id;
  RETURN r;
END;
$_$;

CREATE OR REPLACE FUNCTION public.agent_durable_commit(p_run_id uuid, p_worker_id text, p_fence bigint, p_sequence bigint, p_writes jsonb, p_checkpoint jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE existing jsonb; previous bigint; w jsonb; command_sequence bigint;
BEGIN
  PERFORM public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  IF p_sequence<1 OR jsonb_typeof(p_writes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'AGENT_DURABLE_COMMIT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT writes INTO existing FROM public.agent_durable_commits WHERE run_id=p_run_id AND sequence=p_sequence;
  IF FOUND THEN
    IF existing IS DISTINCT FROM p_writes THEN RAISE EXCEPTION 'AGENT_DURABLE_CONFLICT' USING ERRCODE='40001'; END IF;
    RETURN p_sequence;
  END IF;
  SELECT coalesce(max(sequence),0) INTO previous FROM public.agent_durable_commits WHERE run_id=p_run_id;
  IF p_sequence<>previous+1 THEN RAISE EXCEPTION 'AGENT_DURABLE_CONFLICT' USING ERRCODE='40001'; END IF;
  INSERT INTO public.agent_durable_commits(run_id,sequence,writes) VALUES(p_run_id,p_sequence,p_writes);
  UPDATE public.agent_runs SET checkpoint=p_checkpoint,updated_at=now() WHERE id=p_run_id;
  -- Admission alone is not consumption. Pi records a placed submission before
  -- advancing its model task; acknowledge the matching outer command atomically.
  FOR w IN SELECT value FROM jsonb_array_elements(p_writes) LOOP
    IF w->>'type'='submission'
      AND w#>>'{value,requestId}' ~ '^command:[0-9]+$' THEN
      command_sequence:=substring(w#>>'{value,requestId}' FROM 9)::bigint;
      UPDATE public.agent_run_commands SET durable_admitted=true,
        consumed=consumed OR w#>>'{value,status}' IN ('placed','done')
        WHERE run_id=p_run_id AND sequence=command_sequence;
    END IF;
  END LOOP;
  RETURN p_sequence;
END;
$_$;

CREATE OR REPLACE FUNCTION public.agent_durable_read(p_run_id uuid, p_worker_id text, p_fence bigint, p_after bigint DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  IF p_after<0 THEN RAISE EXCEPTION 'AGENT_DURABLE_CURSOR_INVALID' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('sequence',c.sequence,'writes',c.writes) ORDER BY c.sequence),'[]')
    INTO result FROM (SELECT sequence,writes FROM public.agent_durable_commits
      WHERE run_id=p_run_id AND sequence>p_after ORDER BY sequence LIMIT 200) c;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_emit(p_run_id uuid, p_type text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE cursor_value bigint;
BEGIN
  INSERT INTO public.agent_run_events(run_id,type,payload) VALUES(p_run_id,p_type,p_payload) RETURNING sequence INTO cursor_value;
  UPDATE public.agent_runs SET event_cursor=cursor_value WHERE id=p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_fill_master_review(p_run public.agent_runs, p_chart_id uuid, p_review jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_profile uuid; current_review jsonb; merged jsonb; filled text[]:='{}'; god text;
  gods text[]:=ARRAY['yongShen','xiShen','jiShen','xianShen'];
BEGIN
  IF jsonb_typeof(p_review) IS DISTINCT FROM 'object'
    OR (p_review ? 'strengthLevel' AND coalesce(p_review->>'strengthLevel','') NOT IN ('极弱','偏弱','中和','偏强','极强','从格'))
    OR (p_review ? 'patterns' AND (jsonb_typeof(p_review->'patterns')<>'array' OR jsonb_array_length(p_review->'patterns')=0))
    OR (p_review ? 'gods' AND jsonb_typeof(p_review->'gods')<>'object') THEN
    RAISE EXCEPTION 'AGENT_ARCHIVE_ENTRY_INVALID' USING ERRCODE='22023';
  END IF;
  IF NOT public.agent_archive_chart_owned(p_run.user_id,'bazi_chart',p_chart_id) THEN
    RAISE EXCEPTION 'AGENT_ARCHIVE_CHART_NOT_FOUND' USING ERRCODE='P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('bazi_case_profile'),hashtext(p_chart_id::text));
  INSERT INTO public.bazi_case_profiles(user_id,bazi_chart_id) VALUES(p_run.user_id,p_chart_id) ON CONFLICT(bazi_chart_id) DO NOTHING;
  SELECT id,master_review INTO STRICT v_profile,current_review FROM public.bazi_case_profiles
    WHERE bazi_chart_id=p_chart_id AND user_id=p_run.user_id FOR UPDATE;
  -- The same shape the case notes page saves, so its next save keeps the source while nothing changed.
  merged:=jsonb_build_object(
    'strengthLevel',coalesce(current_review->'strengthLevel','null'::jsonb),
    'patterns',coalesce(current_review->'patterns','[]'::jsonb),
    'summary',coalesce(current_review->'summary','""'::jsonb));
  FOREACH god IN ARRAY gods LOOP
    merged:=merged||jsonb_build_object(god,jsonb_build_object(
      'basic',coalesce(current_review->god->'basic','[]'::jsonb),'advanced',coalesce(current_review->god->'advanced','[]'::jsonb)));
  END LOOP;
  IF p_review ? 'strengthLevel' AND coalesce(merged->>'strengthLevel','')='' THEN
    merged:=jsonb_set(merged,'{strengthLevel}',p_review->'strengthLevel'); filled:=filled||'strengthLevel'::text;
  END IF;
  IF p_review ? 'patterns' AND jsonb_array_length(merged->'patterns')=0 THEN
    merged:=jsonb_set(merged,'{patterns}',p_review->'patterns'); filled:=filled||'patterns'::text;
  END IF;
  IF p_review ? 'gods' AND NOT EXISTS(SELECT 1 FROM unnest(gods) g
      WHERE jsonb_array_length(merged->g->'basic')>0 OR jsonb_array_length(merged->g->'advanced')>0) THEN
    FOREACH god IN ARRAY gods LOOP
      merged:=jsonb_set(merged,ARRAY[god],jsonb_build_object(
        'basic',coalesce(p_review->'gods'->god->'basic','[]'::jsonb),'advanced',coalesce(p_review->'gods'->god->'advanced','[]'::jsonb)));
    END LOOP;
    filled:=filled||'gods'::text;
  END IF;
  IF cardinality(filled)>0 THEN
    UPDATE public.bazi_case_profiles SET master_review=merged,source_run_id=p_run.id,updated_at=now() WHERE id=v_profile;
  END IF;
  RETURN jsonb_build_object('target','master_review','id',v_profile,'filled',to_jsonb(filled));
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_finish_run(p_run_id uuid, p_worker_id text, p_fence bigint, p_status text, p_checkpoint jsonb, p_message jsonb) RETURNS public.agent_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs; final_status text;
BEGIN
  r:=public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  IF p_status NOT IN ('completed','awaiting_input','failed','cancelled') THEN RAISE EXCEPTION 'AGENT_INVALID_STATUS'; END IF;
  final_status:=CASE WHEN r.cancel_requested THEN 'cancelled' ELSE p_status END;
  IF final_status IN ('completed','awaiting_input') AND EXISTS(SELECT 1 FROM public.agent_run_commands WHERE run_id=p_run_id AND NOT consumed AND (final_status<>'awaiting_input' OR (mode='reply' AND NOT durable_admitted))) THEN
    final_status:='queued';
  END IF;
  p_message:=jsonb_set(p_message,'{agent,status}',to_jsonb(final_status));
  UPDATE public.agent_runs SET status=final_status,checkpoint=p_checkpoint,public_message=p_message,
    lease_until=NULL,worker_id=NULL,updated_at=now() WHERE id=p_run_id RETURNING * INTO r;
  IF final_status IN ('completed','failed','cancelled') THEN DELETE FROM public.agent_run_credentials WHERE run_id=p_run_id; END IF;
  PERFORM public.agent_emit(p_run_id,final_status);
  PERFORM public.agent_sync_message(p_run_id);
  SELECT * INTO r FROM public.agent_runs WHERE id=p_run_id;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_local_to_utc(p_local timestamp without time zone, p_timezone text) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE candidate timestamp with time zone; local_value timestamp := p_local; guard integer := 0;
BEGIN
  candidate := local_value AT TIME ZONE p_timezone;
  -- A wall time skipped by spring-forward does not round-trip; move to the first
  -- minute that exists on that day instead of silently landing in another hour.
  WHILE (candidate AT TIME ZONE p_timezone) IS DISTINCT FROM local_value AND guard < 4 LOOP
    local_value := local_value + interval '30 minutes';
    candidate := local_value AT TIME ZONE p_timezone;
    guard := guard + 1;
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_next_run_at(p_cadence jsonb, p_timezone text, p_after timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  kind text; zone text; time_text text; hour_part integer; minute_part integer;
  local_now timestamp; candidate timestamp; day_number integer; last_day integer;
  hours_step integer; offset_days integer;
BEGIN
  IF p_cadence IS NULL OR jsonb_typeof(p_cadence) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'AGENT_SCHEDULE_CADENCE_INVALID' USING ERRCODE='22023'; END IF;
  kind := p_cadence->>'kind';
  zone := coalesce(nullif(btrim(p_timezone),''),'Asia/Shanghai');
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN RAISE EXCEPTION 'AGENT_SCHEDULE_TIMEZONE_INVALID' USING ERRCODE='22023'; END IF;
  time_text := coalesce(nullif(p_cadence->>'time',''),'08:00');
  IF time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'AGENT_SCHEDULE_TIME_INVALID' USING ERRCODE='22023'; END IF;
  hour_part := substring(time_text from 1 for 2)::integer;
  minute_part := substring(time_text from 4 for 2)::integer;
  local_now := p_after AT TIME ZONE zone;
  IF kind='daily' THEN
    candidate := date_trunc('day',local_now) + make_interval(hours=>hour_part,mins=>minute_part);
    IF public.agent_local_to_utc(candidate,zone) <= p_after THEN candidate := candidate + interval '1 day'; END IF;
    RETURN public.agent_local_to_utc(candidate,zone);
  ELSIF kind='weekly' THEN
    IF jsonb_typeof(p_cadence->'weekdays') IS DISTINCT FROM 'array' OR jsonb_array_length(p_cadence->'weekdays')=0 THEN RAISE EXCEPTION 'AGENT_SCHEDULE_CADENCE_INVALID' USING ERRCODE='22023'; END IF;
    FOR offset_days IN 0..7 LOOP
      candidate := date_trunc('day',local_now) + make_interval(days=>offset_days,hours=>hour_part,mins=>minute_part);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_cadence->'weekdays') AS w(value) WHERE w.value::integer=extract(isodow FROM candidate)::integer)
        AND public.agent_local_to_utc(candidate,zone) > p_after THEN
        RETURN public.agent_local_to_utc(candidate,zone);
      END IF;
    END LOOP;
    RAISE EXCEPTION 'AGENT_SCHEDULE_CADENCE_INVALID' USING ERRCODE='22023';
  ELSIF kind='monthly' THEN
    day_number := coalesce((p_cadence->>'day')::integer,0);
    IF day_number<1 OR day_number>31 THEN RAISE EXCEPTION 'AGENT_SCHEDULE_CADENCE_INVALID' USING ERRCODE='22023'; END IF;
    candidate := date_trunc('month',local_now);
    last_day := extract(day FROM candidate + interval '1 month - 1 day')::integer;
    candidate := candidate + make_interval(days=>least(day_number,last_day)-1,hours=>hour_part,mins=>minute_part);
    IF public.agent_local_to_utc(candidate,zone) <= p_after THEN
      candidate := date_trunc('month',local_now) + interval '1 month';
      last_day := extract(day FROM candidate + interval '1 month - 1 day')::integer;
      candidate := candidate + make_interval(days=>least(day_number,last_day)-1,hours=>hour_part,mins=>minute_part);
    END IF;
    RETURN public.agent_local_to_utc(candidate,zone);
  ELSIF kind='interval' THEN
    hours_step := coalesce((p_cadence->>'hours')::integer,0);
    IF hours_step<1 OR hours_step>24 THEN RAISE EXCEPTION 'AGENT_SCHEDULE_CADENCE_INVALID' USING ERRCODE='22023'; END IF;
    candidate := date_trunc('day',local_now) + make_interval(hours=>hour_part,mins=>minute_part);
    IF candidate > local_now THEN
      -- Before today's HH:mm the previous day's chain still steps through the
      -- hours after midnight; it ends at the first step at or after today's anchor.
      candidate := candidate - interval '1 day';
      WHILE candidate + make_interval(hours=>hours_step) <= local_now LOOP candidate := candidate + make_interval(hours=>hours_step); END LOOP;
      candidate := candidate + make_interval(hours=>hours_step);
      IF candidate >= date_trunc('day',local_now) + make_interval(hours=>hour_part,mins=>minute_part) THEN
        candidate := date_trunc('day',local_now) + make_interval(hours=>hour_part,mins=>minute_part);
      END IF;
      RETURN public.agent_local_to_utc(candidate,zone);
    END IF;
    WHILE candidate <= local_now LOOP candidate := candidate + make_interval(hours=>hours_step); END LOOP;
    RETURN public.agent_local_to_utc(candidate,zone);
  END IF;
  RAISE EXCEPTION 'AGENT_SCHEDULE_CADENCE_INVALID' USING ERRCODE='22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_latest_schedule_occurrence(p_cadence jsonb, p_timezone text, p_before timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  kind text; zone text; time_text text; hour_part integer; minute_part integer;
  local_now timestamp; candidate timestamp; day_number integer; last_day integer;
  hours_step integer; offset_days integer;
BEGIN
  IF p_cadence IS NULL OR jsonb_typeof(p_cadence) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  kind := p_cadence->>'kind';
  zone := coalesce(nullif(btrim(p_timezone),''),'Asia/Shanghai');
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN RETURN NULL; END IF;
  time_text := coalesce(nullif(p_cadence->>'time',''),'08:00');
  IF time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RETURN NULL; END IF;
  hour_part := substring(time_text from 1 for 2)::integer;
  minute_part := substring(time_text from 4 for 2)::integer;
  local_now := p_before AT TIME ZONE zone;
  IF kind='daily' THEN
    candidate := date_trunc('day',local_now) + make_interval(hours=>hour_part,mins=>minute_part);
    IF public.agent_local_to_utc(candidate,zone) > p_before THEN candidate := candidate - interval '1 day'; END IF;
    RETURN public.agent_local_to_utc(candidate,zone);
  ELSIF kind='weekly' THEN
    IF jsonb_typeof(p_cadence->'weekdays') IS DISTINCT FROM 'array' OR jsonb_array_length(p_cadence->'weekdays')=0 THEN RETURN NULL; END IF;
    FOR offset_days IN 0..7 LOOP
      candidate := date_trunc('day',local_now) - make_interval(days=>offset_days) + make_interval(hours=>hour_part,mins=>minute_part);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_cadence->'weekdays') AS w(value) WHERE w.value::integer=extract(isodow FROM candidate)::integer)
        AND public.agent_local_to_utc(candidate,zone) <= p_before THEN
        RETURN public.agent_local_to_utc(candidate,zone);
      END IF;
    END LOOP;
    RETURN NULL;
  ELSIF kind='monthly' THEN
    day_number := coalesce((p_cadence->>'day')::integer,0);
    IF day_number<1 OR day_number>31 THEN RETURN NULL; END IF;
    candidate := date_trunc('month',local_now);
    last_day := extract(day FROM candidate + interval '1 month - 1 day')::integer;
    candidate := candidate + make_interval(days=>least(day_number,last_day)-1,hours=>hour_part,mins=>minute_part);
    IF public.agent_local_to_utc(candidate,zone) > p_before THEN
      candidate := date_trunc('month',local_now) - interval '1 month';
      last_day := extract(day FROM candidate + interval '1 month - 1 day')::integer;
      candidate := candidate + make_interval(days=>least(day_number,last_day)-1,hours=>hour_part,mins=>minute_part);
    END IF;
    RETURN public.agent_local_to_utc(candidate,zone);
  ELSIF kind='interval' THEN
    hours_step := coalesce((p_cadence->>'hours')::integer,0);
    IF hours_step<1 OR hours_step>24 THEN RETURN NULL; END IF;
    -- Occurrences are the day's HH:mm plus whole steps. Start from today's
    -- anchor, or from yesterday's when today's has not arrived yet, then walk
    -- forward to the newest step at or before the instant; a chain truncated by
    -- midnight still has its last step that fell on the current day.
    candidate := date_trunc('day',local_now) + make_interval(hours=>hour_part,mins=>minute_part);
    IF candidate > local_now THEN candidate := candidate - interval '1 day'; END IF;
    WHILE candidate + make_interval(hours=>hours_step) <= local_now LOOP candidate := candidate + make_interval(hours=>hours_step); END LOOP;
    WHILE public.agent_local_to_utc(candidate,zone) > p_before LOOP candidate := candidate - make_interval(hours=>hours_step); END LOOP;
    RETURN public.agent_local_to_utc(candidate,zone);
  END IF;
  RETURN NULL;
END;
$$;

-- The number of schedules each member may keep. Read inside the definer context, so
-- the caller cannot argue a quota of its own; the default matches the application's.
CREATE OR REPLACE FUNCTION public.agent_schedule_limit() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT coalesce((
    SELECT least((s.setting_value->>'limit')::integer, 100)
      FROM public.app_settings s
     WHERE s.setting_key = 'agent_schedule_limits' AND s.setting_value->>'limit' ~ '^[0-9]{1,3}$'), 20);
$$;

CREATE OR REPLACE FUNCTION public.create_agent_schedule(p_name text, p_template text, p_prompt text, p_cadence jsonb, p_timezone text, p_options jsonb) RETURNS public.agent_schedules
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_user uuid := auth.uid(); v_conversation uuid; v_next timestamp with time zone; v_count integer; v_limit integer; s public.agent_schedules;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF coalesce(btrim(p_name),'')='' OR length(p_name)>80 THEN RAISE EXCEPTION 'AGENT_SCHEDULE_NAME_INVALID' USING ERRCODE='22023'; END IF;
  IF coalesce(btrim(p_prompt),'')='' OR length(p_prompt)>4000 THEN RAISE EXCEPTION 'AGENT_SCHEDULE_PROMPT_INVALID' USING ERRCODE='22023'; END IF;
  IF p_template NOT IN ('custom','daily_briefing') THEN RAISE EXCEPTION 'AGENT_SCHEDULE_TEMPLATE_INVALID' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_options) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'AGENT_SCHEDULE_OPTIONS_INVALID' USING ERRCODE='22023'; END IF;
  -- Serialize the count and the insert so two tabs cannot exceed the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text,721));
  -- The limit is read here, never taken from the caller.
  v_limit := public.agent_schedule_limit();
  SELECT count(*) INTO v_count FROM public.agent_schedules WHERE user_id=v_user;
  IF v_count >= v_limit THEN RAISE EXCEPTION 'AGENT_SCHEDULE_LIMIT' USING ERRCODE='23505'; END IF;
  v_next := public.agent_next_run_at(p_cadence,p_timezone,now());
  INSERT INTO public.conversations(user_id,title,messages)
    VALUES(v_user,'定时 · '||left(btrim(p_name),60),'[]'::jsonb)
    RETURNING id INTO v_conversation;
  INSERT INTO public.agent_schedules(user_id,name,template,prompt,cadence,timezone,conversation_id,options,enabled,next_run_at)
    VALUES(v_user,btrim(p_name),p_template,p_prompt,p_cadence,coalesce(nullif(btrim(p_timezone),''),'Asia/Shanghai'),v_conversation,p_options,true,v_next)
    RETURNING * INTO s;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_agent_schedule(p_id uuid, p_name text, p_prompt text, p_cadence jsonb, p_timezone text, p_options jsonb, p_enabled boolean) RETURNS public.agent_schedules
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE s public.agent_schedules; v_next timestamp with time zone;
BEGIN
  SELECT * INTO s FROM public.agent_schedules WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR (s.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_user()) THEN RAISE EXCEPTION 'AGENT_SCHEDULE_NOT_FOUND' USING ERRCODE='42501'; END IF;
  IF coalesce(btrim(p_name),'')='' OR length(p_name)>80 THEN RAISE EXCEPTION 'AGENT_SCHEDULE_NAME_INVALID' USING ERRCODE='22023'; END IF;
  IF coalesce(btrim(p_prompt),'')='' OR length(p_prompt)>4000 THEN RAISE EXCEPTION 'AGENT_SCHEDULE_PROMPT_INVALID' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_options) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'AGENT_SCHEDULE_OPTIONS_INVALID' USING ERRCODE='22023'; END IF;
  IF p_enabled AND s.conversation_id IS NULL THEN RAISE EXCEPTION 'AGENT_SCHEDULE_CONVERSATION_MISSING' USING ERRCODE='23505'; END IF;
  -- Switching a paused schedule back on may not push the member past the limit again.
  IF p_enabled AND NOT s.enabled
     AND (SELECT count(*) FROM public.agent_schedules WHERE user_id=s.user_id AND enabled) >= public.agent_schedule_limit() THEN
    RAISE EXCEPTION 'AGENT_SCHEDULE_LIMIT' USING ERRCODE='23505';
  END IF;
  v_next := CASE WHEN p_enabled THEN public.agent_next_run_at(p_cadence,p_timezone,now()) ELSE NULL END;
  UPDATE public.agent_schedules SET name=btrim(p_name),prompt=p_prompt,cadence=p_cadence,
    timezone=coalesce(nullif(btrim(p_timezone),''),'Asia/Shanghai'),options=p_options,enabled=p_enabled,
    next_run_at=v_next,
    last_status=CASE WHEN p_enabled AND last_status='paused' THEN NULL ELSE last_status END,
    consecutive_failures=CASE WHEN p_enabled THEN 0 ELSE consecutive_failures END,
    updated_at=now()
  WHERE id=p_id RETURNING * INTO s;
  RETURN s;
END;
$$;

-- The manual "run now" occurrence. Table writes stay owner-only under RLS, so the
-- row is created here: the member's own request, or an administrator acting for
-- the scheduler. The busy check and the insert share the schedule's row lock.
CREATE OR REPLACE FUNCTION public.create_agent_schedule_run(p_schedule_id uuid, p_user_id uuid) RETURNS public.agent_schedule_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE s public.agent_schedules; r public.agent_schedule_runs;
BEGIN
  IF p_user_id IS NULL OR (p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_user()) THEN
    RAISE EXCEPTION 'AGENT_SCHEDULE_NOT_FOUND' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM public.agent_schedules WHERE id=p_schedule_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SCHEDULE_NOT_FOUND' USING ERRCODE='42501'; END IF;
  IF s.conversation_id IS NULL THEN RAISE EXCEPTION 'AGENT_SCHEDULE_CONVERSATION_MISSING' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT 1 FROM public.agent_schedule_runs WHERE schedule_id=s.id AND status IN ('pending','running')) THEN
    RAISE EXCEPTION 'AGENT_SCHEDULE_RUN_BUSY' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.agent_schedule_runs(schedule_id,user_id,scheduled_for,status)
    VALUES(s.id,s.user_id,now(),'pending')
    RETURNING * INTO r;
  RETURN r;
END;
$$;

-- Pauses the newest enabled schedules beyond the limit, after an administrator lowers it.
CREATE OR REPLACE FUNCTION public.enforce_agent_schedule_limits() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE paused integer; v_limit integer;
BEGIN
  PERFORM public.agent_require_admin();
  v_limit := public.agent_schedule_limit();
  WITH ranked AS (
    SELECT s.id,
      row_number() OVER (PARTITION BY s.user_id ORDER BY s.created_at, s.id) AS position
    FROM public.agent_schedules s
    WHERE s.enabled
  ), paused_rows AS (
    UPDATE public.agent_schedules s SET enabled=false,next_run_at=NULL,last_status='paused',updated_at=now()
    FROM ranked r
    WHERE s.id=r.id AND r.position > v_limit
    RETURNING s.id
  )
  SELECT count(*) INTO paused FROM paused_rows;
  RETURN paused;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_settle_schedule_run(p_run_id uuid, p_status text, p_agent_run_id uuid DEFAULT NULL::uuid, p_error text DEFAULT NULL::text, p_skip_reason text DEFAULT NULL::text) RETURNS public.agent_schedule_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_schedule_runs; s public.agent_schedules; v_title text; v_content text; notify boolean;
BEGIN
  SELECT * INTO r FROM public.agent_schedule_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SCHEDULE_RUN_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_status NOT IN ('running','completed','failed','skipped') THEN RAISE EXCEPTION 'AGENT_SCHEDULE_STATUS_INVALID' USING ERRCODE='22023'; END IF;
  IF r.status IN ('completed','failed','skipped') THEN RETURN r; END IF;
  IF p_status='running' AND p_agent_run_id IS NULL THEN RAISE EXCEPTION 'AGENT_SCHEDULE_RUN_REQUIRED' USING ERRCODE='22023'; END IF;
  IF p_status='completed' AND r.status='pending' THEN RAISE EXCEPTION 'AGENT_SCHEDULE_TRANSITION_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.agent_schedule_runs SET status=p_status,
    agent_run_id=coalesce(p_agent_run_id,agent_run_id),
    error=left(coalesce(p_error,error),500),
    skip_reason=coalesce(p_skip_reason,skip_reason),
    started_at=coalesce(started_at,CASE WHEN p_status IN ('running','completed','failed') THEN now() END),
    finished_at=CASE WHEN p_status IN ('completed','failed','skipped') THEN now() ELSE finished_at END
  WHERE id=p_run_id RETURNING * INTO r;
  SELECT * INTO s FROM public.agent_schedules WHERE id=r.schedule_id FOR UPDATE;
  IF FOUND THEN
    UPDATE public.agent_schedules SET
      last_run_at=CASE WHEN p_status IN ('running','completed','failed') THEN now() ELSE last_run_at END,
      last_status=p_status,
      consecutive_failures=CASE WHEN p_status='failed' THEN consecutive_failures+1
        WHEN p_status IN ('completed','skipped') THEN 0 ELSE consecutive_failures END,
      enabled=CASE WHEN p_skip_reason='conversation_missing' THEN false ELSE enabled END,
      next_run_at=CASE WHEN p_skip_reason='conversation_missing' THEN NULL ELSE next_run_at END,
      updated_at=now()
    WHERE id=s.id;
    notify := coalesce((s.options->>'notify')::boolean,true);
    IF p_status='completed' AND notify THEN
      v_title:='定时任务「'||s.name||'」已完成';
      v_content:=to_char(r.scheduled_for AT TIME ZONE s.timezone,'YYYY-MM-DD HH24:MI')||' 的运行已追加到对话。';
    ELSIF p_status='failed' AND notify THEN
      v_title:='定时任务「'||s.name||'」未完成';
      v_content:=coalesce(nullif(btrim(p_error),''),'运行失败，打开对话查看原因。');
    ELSIF p_status='skipped' AND p_skip_reason IN ('insufficient_balance','model_unavailable','feature_disabled','conversation_missing') THEN
      v_title:='定时任务「'||s.name||'」已跳过';
      v_content:=coalesce(nullif(btrim(p_error),''),CASE p_skip_reason
        WHEN 'insufficient_balance' THEN '余额不足，本次运行已跳过。'
        WHEN 'model_unavailable' THEN '模型不可用或未定价，本次运行已跳过。'
        WHEN 'feature_disabled' THEN '功能已关闭，本次运行已跳过。'
        ELSE '绑定的对话已删除，任务已暂停，请重新创建。' END);
    END IF;
    IF v_title IS NOT NULL AND coalesce((SELECT notifications_enabled AND notify_site FROM public.user_settings WHERE user_id=s.user_id),true) THEN
      INSERT INTO public.notifications(user_id,type,title,content,link,event_key,event_data)
        VALUES(s.user_id,'system',v_title,left(v_content,500),
          CASE WHEN s.conversation_id IS NULL THEN '/scheduled' ELSE '/chat?id='||s.conversation_id::text END,
          'schedule:'||r.id::text,
          jsonb_build_object('kind','schedule','scheduleId',s.id,'scheduleRunId',r.id,'conversationId',s.conversation_id,'status',CASE WHEN p_status='skipped' THEN 'skipped' ELSE p_status END))
        ON CONFLICT(user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
    END IF;
  END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_agent_schedule_run(p_run_id uuid, p_status text, p_agent_run_id uuid DEFAULT NULL::uuid, p_error text DEFAULT NULL::text, p_skip_reason text DEFAULT NULL::text) RETURNS public.agent_schedule_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.agent_require_admin();
  RETURN public.agent_settle_schedule_run(p_run_id,p_status,p_agent_run_id,p_error,p_skip_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_schedule_run_finished() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_schedule_runs; reason text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('completed','failed','cancelled') THEN RETURN NEW; END IF;
  FOR r IN SELECT * FROM public.agent_schedule_runs WHERE agent_run_id=NEW.id AND status='running' FOR UPDATE LOOP
    reason:=CASE NEW.status WHEN 'completed' THEN NULL WHEN 'cancelled' THEN '已取消' ELSE '任务运行失败，打开对话查看原因。' END;
    PERFORM public.agent_settle_schedule_run(r.id,CASE WHEN NEW.status='completed' THEN 'completed' ELSE 'failed' END,NEW.id,reason,NULL);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_agent_schedules(p_limit integer DEFAULT 20) RETURNS SETOF public.agent_schedule_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE s public.agent_schedules; due timestamp with time zone; latest timestamp with time zone;
  next_at timestamp with time zone; created_run public.agent_schedule_runs;
BEGIN
  PERFORM public.agent_require_admin();
  IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AGENT_SCHEDULE_LIMIT_INVALID' USING ERRCODE='22023'; END IF;
  -- A scheduler that died between claiming a run and submitting it leaves a row
  -- no completion trigger will ever settle; fail it so the schedule can run again.
  UPDATE public.agent_schedule_runs r SET status='failed',error='调度未提交',finished_at=now()
    WHERE r.status IN ('pending','running') AND r.created_at<now()-interval '5 minutes'
      AND (r.agent_run_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.agent_runs a WHERE a.id=r.agent_run_id));
  UPDATE public.agent_schedule_runs r SET status=CASE WHEN a.status='completed' THEN 'completed' ELSE 'failed' END,
      error=CASE WHEN a.status='completed' THEN NULL ELSE '任务运行已结束' END,finished_at=now()
    FROM public.agent_runs a
    WHERE a.id=r.agent_run_id AND r.status='running' AND a.status IN ('completed','failed','cancelled');
  FOR s IN SELECT * FROM public.agent_schedules
    WHERE enabled AND next_run_at IS NOT NULL AND next_run_at<=now()
    ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    due:=s.next_run_at;
    latest:=public.agent_latest_schedule_occurrence(s.cadence,s.timezone,now());
    IF latest IS NOT NULL AND latest>due THEN due:=latest; END IF;
    next_at:=public.agent_next_run_at(s.cadence,s.timezone,now());
    UPDATE public.agent_schedules SET next_run_at=next_at,updated_at=now() WHERE id=s.id;
    IF s.conversation_id IS NULL THEN
      UPDATE public.agent_schedules SET enabled=false,next_run_at=NULL,last_status='paused',updated_at=now() WHERE id=s.id;
      INSERT INTO public.agent_schedule_runs(schedule_id,user_id,scheduled_for,status,skip_reason,finished_at)
        VALUES(s.id,s.user_id,due,'skipped','conversation_missing',now())
        ON CONFLICT(schedule_id,scheduled_for) DO NOTHING;
      CONTINUE;
    END IF;
    IF EXISTS(SELECT 1 FROM public.agent_schedule_runs WHERE schedule_id=s.id AND status IN ('pending','running')) THEN
      INSERT INTO public.agent_schedule_runs(schedule_id,user_id,scheduled_for,status,skip_reason,finished_at)
        VALUES(s.id,s.user_id,due,'skipped','previous_running',now())
        ON CONFLICT(schedule_id,scheduled_for) DO NOTHING;
      CONTINUE;
    END IF;
    IF due<now()-interval '2 hours' THEN
      INSERT INTO public.agent_schedule_runs(schedule_id,user_id,scheduled_for,status,skip_reason,finished_at)
        VALUES(s.id,s.user_id,due,'skipped','missed',now())
        ON CONFLICT(schedule_id,scheduled_for) DO NOTHING;
      CONTINUE;
    END IF;
    created_run:=NULL;
    INSERT INTO public.agent_schedule_runs(schedule_id,user_id,scheduled_for,status)
      VALUES(s.id,s.user_id,due,'pending')
      ON CONFLICT(schedule_id,scheduled_for) DO NOTHING
      RETURNING * INTO created_run;
    IF created_run.id IS NOT NULL THEN RETURN NEXT created_run; END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_memory_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN PERFORM public.agent_require_admin(); END IF;
  IF NEW.source_run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_runs WHERE id=NEW.source_run_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'AGENT_MEMORY_SOURCE_OWNER'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,910));
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.user_agent_memory WHERE user_id=NEW.user_id AND fingerprint=md5(NEW.content)) AND (SELECT count(*) FROM public.user_agent_memory WHERE user_id=NEW.user_id)>=128 THEN RAISE EXCEPTION 'AGENT_MEMORY_LIMIT'; END IF;
  NEW.updated_at:=now(); RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_notify_command() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform pg_notify('taibu-agent', json_build_object(
    't', 'cmd',
    'run', NEW.run_id
  )::text);
  return NEW;
end;
$$;

CREATE OR REPLACE FUNCTION public.agent_notify_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform pg_notify('taibu-agent', json_build_object(
    't', 'event',
    'run', NEW.run_id,
    'seq', NEW.sequence
  )::text);
  return NEW;
end;
$$;

CREATE OR REPLACE FUNCTION public.agent_notify_run() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform pg_notify('taibu-agent', json_build_object(
    't', 'run',
    'run', NEW.id,
    'status', NEW.status,
    'cancel', coalesce(NEW.cancel_requested, false)
  )::text);
  if NEW.status = 'queued' then
    perform pg_notify('taibu-agent', json_build_object('t', 'queue')::text);
  end if;
  return NEW;
end;
$$;

CREATE OR REPLACE FUNCTION public.agent_protect_conversation_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE paused integer;
BEGIN
  IF EXISTS(SELECT 1 FROM public.agent_runs WHERE conversation_id=OLD.id AND status IN ('queued','running','awaiting_input','cancelling')) THEN
    RAISE EXCEPTION 'AGENT_CONVERSATION_BUSY' USING ERRCODE='23505';
  END IF;
  -- A schedule runs in one fixed conversation. Deleting that conversation pauses the
  -- schedule instead of cascading it away, and tells the owner to rebuild it.
  UPDATE public.agent_schedules SET enabled=false,next_run_at=NULL,last_status='paused',updated_at=now()
    WHERE conversation_id=OLD.id AND user_id=OLD.user_id AND enabled;
  GET DIAGNOSTICS paused = ROW_COUNT;
  IF paused>0 AND coalesce((SELECT notifications_enabled AND notify_site FROM public.user_settings WHERE user_id=OLD.user_id),true) THEN
    INSERT INTO public.notifications(user_id,type,title,content,link,event_key,event_data)
      VALUES(OLD.user_id,'system','定时任务已暂停','绑定的对话已删除，请到「定时任务」重新创建任务。','/scheduled','schedule-paused:'||OLD.id::text,jsonb_build_object('kind','schedule','conversationId',OLD.id))
      ON CONFLICT(user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_protect_conversation_messages() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF OLD.messages IS DISTINCT FROM NEW.messages AND coalesce(current_setting('taibu.agent_write',true),'')<>'true'
    AND EXISTS(SELECT 1 FROM public.agent_runs WHERE conversation_id=OLD.id AND status IN ('queued','running','awaiting_input','cancelling')) THEN
    RAISE EXCEPTION 'AGENT_CONVERSATION_BUSY' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_protect_normalized_messages() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE target_id uuid;
BEGIN
  IF coalesce(current_setting('taibu.agent_write',true),'')<>'true' THEN
    target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
    IF EXISTS(SELECT 1 FROM public.agent_runs r JOIN public.conversations c ON c.id=r.conversation_id
      WHERE r.conversation_id=target_id AND r.status IN ('queued','running','awaiting_input','cancelling'))
      OR (TG_OP='UPDATE' AND OLD.conversation_id IS DISTINCT FROM NEW.conversation_id AND EXISTS(SELECT 1 FROM public.agent_runs r JOIN public.conversations c ON c.id=r.conversation_id
      WHERE r.conversation_id=OLD.conversation_id AND r.status IN ('queued','running','awaiting_input','cancelling'))) THEN
      RAISE EXCEPTION 'AGENT_CONVERSATION_BUSY' USING ERRCODE='23505';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_record_user_event(p_run_id uuid, p_worker_id text, p_fence bigint, p_call_id text, p_chart_type text, p_chart_id uuid, p_event_date date, p_category text, p_title text, p_evidence text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs;
BEGIN
  r:=public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  IF r.cancel_requested THEN RAISE EXCEPTION 'AGENT_CANCELLED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_settings WHERE user_id=r.user_id AND chat_preferences->>'memoryEnabled'='true') THEN
    RAISE EXCEPTION 'AGENT_MEMORY_DISABLED';
  END IF;
  IF p_evidence IS NULL OR length(btrim(p_evidence))<4 OR length(p_evidence)>500 OR NOT public.agent_user_said(r,p_evidence) THEN
    RAISE EXCEPTION 'AGENT_ARCHIVE_EVIDENCE_REQUIRED';
  END IF;
  RETURN public.agent_archive_event(r,public.agent_archive_entry_id(r.id,p_call_id),p_chart_type,p_chart_id,p_event_date,p_category,p_title,btrim(p_evidence));
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_renew_lease(p_run_id uuid, p_worker_id text, p_fence bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs;
BEGIN
  r:=public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  UPDATE public.agent_runs SET lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=p_run_id;
  RETURN r.cancel_requested;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_require_admin() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'AGENT_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_require_lease(p_run_id uuid, p_worker_id text, p_fence bigint) RETURNS public.agent_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs;
BEGIN
  PERFORM public.agent_require_admin();
  SELECT * INTO r FROM public.agent_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR r.worker_id IS DISTINCT FROM p_worker_id OR r.fence<>p_fence
    OR r.lease_until IS NULL OR r.lease_until<=now() OR r.status NOT IN ('running','cancelling') THEN
    RAISE EXCEPTION 'AGENT_LEASE_LOST' USING ERRCODE='40001';
  END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_run_metrics_summary(p_days integer DEFAULT 7) RETURNS TABLE(model_id text, runs bigint, p50_total_ms integer, p95_total_ms integer, p50_first_token_ms integer, p95_first_token_ms integer, tool_share double precision, failure_rate double precision, hang_rate double precision)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_admin_user() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_days < 1 or p_days > 90 then
    raise exception 'invalid metrics window' using errcode = '22023';
  end if;
  return query
  select m.model_id,
    count(*)::bigint,
    coalesce(round(percentile_cont(0.5) within group (order by m.total_ms)), 0)::integer,
    coalesce(round(percentile_cont(0.95) within group (order by m.total_ms)), 0)::integer,
    round(percentile_cont(0.5) within group (order by m.first_token_ms))::integer,
    round(percentile_cont(0.95) within group (order by m.first_token_ms))::integer,
    coalesce(sum(m.tool_ms)::double precision / nullif(sum(m.total_ms), 0), 0),
    avg(case when m.status = 'failed' then 1 else 0 end)::double precision,
    avg(case when m.hangs > 0 then 1 else 0 end)::double precision
  from public.agent_run_metrics m
  where m.ended_at >= now() - make_interval(days => p_days)
  group by m.model_id
  order by m.model_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.agent_save_archive_proposal(p_run_id uuid, p_call_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs; a public.agent_run_artifacts; p jsonb; v_id uuid; v_chart_type text; v_chart_id uuid;
BEGIN
  SELECT * INTO r FROM public.agent_runs WHERE id=p_run_id;
  IF NOT FOUND OR r.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'AGENT_RUN_NOT_FOUND' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.agent_run_artifacts WHERE run_id=r.id AND call_id=p_call_id AND tool_name='propose_archive_entry' AND kind='tool';
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_ARCHIVE_PROPOSAL_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  p:=a.result->'details'->'proposal';
  v_id:=public.agent_archive_entry_id(r.id,p_call_id);
  v_chart_type:=nullif(p->'chart'->>'type','');
  v_chart_id:=nullif(p->'chart'->>'id','')::uuid;
  CASE p->>'kind'
    WHEN 'event' THEN
      RETURN public.agent_archive_event(r,v_id,v_chart_type,v_chart_id,(p->>'date')::date,p->>'category',p->>'title',p->>'detail');
    WHEN 'master_review' THEN
      IF v_chart_type IS DISTINCT FROM 'bazi_chart' THEN RAISE EXCEPTION 'AGENT_ARCHIVE_ENTRY_INVALID' USING ERRCODE='22023'; END IF;
      RETURN public.agent_fill_master_review(r,v_chart_id,p->'review');
    WHEN 'conclusion' THEN
      IF length(btrim(coalesce(p->>'title',''))) NOT BETWEEN 1 AND 80 OR length(coalesce(p->>'content',''))>4000
        OR coalesce(p->>'category','') NOT IN ('prediction','general') THEN
        RAISE EXCEPTION 'AGENT_ARCHIVE_ENTRY_INVALID' USING ERRCODE='22023';
      END IF;
      IF v_chart_type IS NOT NULL AND NOT public.agent_archive_chart_owned(r.user_id,v_chart_type,v_chart_id) THEN
        RAISE EXCEPTION 'AGENT_ARCHIVE_CHART_NOT_FOUND' USING ERRCODE='P0002';
      END IF;
      INSERT INTO public.ming_records(id,user_id,title,content,category,tags,event_date,related_chart_type,related_chart_id,source_run_id)
        VALUES(v_id,r.user_id,btrim(p->>'title'),nullif(btrim(coalesce(p->>'content','')),''),p->>'category',
          ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'tags','[]'::jsonb))),nullif(p->>'date','')::date,v_chart_type,v_chart_id,r.id)
        ON CONFLICT(id) DO NOTHING;
      RETURN jsonb_build_object('target','record','id',v_id);
    ELSE
      RAISE EXCEPTION 'AGENT_ARCHIVE_ENTRY_INVALID' USING ERRCODE='22023';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_search_conversations(p_run_id uuid, p_worker_id text, p_fence bigint, p_query text, p_limit integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs; terms text[]; patterns text[]; result jsonb;
BEGIN
  r:=public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  IF NOT EXISTS(SELECT 1 FROM public.user_settings WHERE user_id=r.user_id AND chat_preferences->>'memoryEnabled'='true') THEN
    RAISE EXCEPTION 'AGENT_MEMORY_DISABLED';
  END IF;
  terms:=ARRAY(SELECT t FROM regexp_split_to_table(btrim(coalesce(p_query,'')),'\s+') t WHERE t<>'' ORDER BY length(t) DESC);
  IF cardinality(terms) NOT BETWEEN 1 AND 5 OR length(p_query)>80 THEN RAISE EXCEPTION 'AGENT_SEARCH_QUERY_INVALID' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>20 THEN RAISE EXCEPTION 'INVALID_SEARCH_LIMIT' USING ERRCODE='22023'; END IF;
  patterns:=ARRAY(SELECT '%'||replace(replace(replace(t,'\','\\'),'%','\%'),'_','\_')||'%' FROM unnest(terms) t);
  SELECT coalesce(jsonb_agg(found.entry ORDER BY found.updated_at DESC,found.sequence),'[]'::jsonb) INTO result FROM (
    SELECT c.updated_at,m.sequence,jsonb_build_object(
      'conversationId',c.id,'messageId',m.message_id,'title',c.title,'updatedAt',c.updated_at,'role',m.role,
      'excerpt',substr(m.content,greatest(1,strpos(lower(m.content),lower(terms[1]))-80),300),
      'reply',CASE WHEN m.role='user' THEN (SELECT left(n.content,600) FROM public.conversation_messages n
        WHERE n.conversation_id=m.conversation_id AND n.sequence>m.sequence AND n.role='assistant' ORDER BY n.sequence LIMIT 1) END,
      'question',CASE WHEN m.role='assistant' THEN (SELECT left(q.content,200) FROM public.conversation_messages q
        WHERE q.conversation_id=m.conversation_id AND q.sequence<m.sequence AND q.role='user' ORDER BY q.sequence DESC LIMIT 1) END
    ) AS entry
    FROM public.conversation_messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE c.user_id=r.user_id AND c.id<>r.conversation_id AND m.role IN ('user','assistant')
      AND m.content ILIKE patterns[1] AND m.content ILIKE ALL(patterns)
    ORDER BY c.updated_at DESC,m.sequence
    LIMIT p_limit
  ) found;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_search_knowledge(p_run_id uuid, p_worker_id text, p_fence bigint, p_method text, p_args jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE r public.agent_runs; result jsonb; previous_sub text; previous_claims text; kb_ids uuid[]; query_text text; max_rows integer;
BEGIN
  r:=public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  SELECT array_agg(v::uuid) INTO kb_ids FROM jsonb_array_elements_text(nullif(p_args->'p_kb_ids','null'::jsonb)) AS t(v);
  query_text:=p_args->>'p_query'; max_rows:=coalesce((p_args->>'p_limit')::integer,20);
  IF max_rows<1 OR max_rows>100 THEN RAISE EXCEPTION 'INVALID_SEARCH_LIMIT'; END IF;
  previous_sub:=current_setting('request.jwt.claim.sub',true); previous_claims:=current_setting('request.jwt.claims',true);
  PERFORM set_config('request.jwt.claim.sub',r.user_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',r.user_id,'role','authenticated')::text,true);
  BEGIN
    CASE p_method
      WHEN 'fts' THEN SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO result FROM public.search_knowledge_fts(query_text,kb_ids,max_rows,coalesce(p_args->>'p_config','simple')) q;
      WHEN 'trigram' THEN SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO result FROM public.search_knowledge_trigram(query_text,kb_ids,max_rows,coalesce((p_args->>'p_threshold')::real,0.3)) q;
      WHEN 'vector' THEN SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO result FROM public.search_knowledge_vector(ARRAY(SELECT v::float8 FROM jsonb_array_elements_text(p_args->'p_query_vector') t(v)),kb_ids,max_rows,(p_args->>'p_dim')::integer) q;
      WHEN 'weights' THEN SELECT coalesce(jsonb_agg(jsonb_build_object('id',kb.id,'weight',kb.weight)),'[]') INTO result FROM public.knowledge_bases kb WHERE kb.user_id=r.user_id AND kb.id=ANY(kb_ids);
      ELSE RAISE EXCEPTION 'INVALID_SEARCH_METHOD';
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true); PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true); PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_submit_command(p_run_id uuid, p_request_id text, p_mode text, p_message jsonb) RETURNS public.agent_run_commands
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs; cmd public.agent_run_commands; messages jsonb; previous_write text; question_id text;
BEGIN
  SELECT * INTO r FROM public.agent_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR (r.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_user()) THEN
    RAISE EXCEPTION 'AGENT_RUN_NOT_FOUND' USING ERRCODE='42501';
  END IF;
  SELECT * INTO cmd FROM public.agent_run_commands WHERE run_id=p_run_id AND request_id=p_request_id;
  IF FOUND THEN
    IF cmd.original_message->>'content' IS DISTINCT FROM p_message->>'content' OR cmd.original_mode<>p_mode
      OR cmd.original_message#>'{metadata,agentAnswers}' IS DISTINCT FROM p_message#>'{metadata,agentAnswers}'
      OR cmd.original_message->'attachments' IS DISTINCT FROM p_message->'attachments' THEN
      RAISE EXCEPTION 'AGENT_REQUEST_MISMATCH' USING ERRCODE='22023';
    END IF;
    RETURN cmd;
  END IF;
  question_id:=NULLIF(p_message#>>'{metadata,agentQuestionId}','');
  IF p_mode='reply' AND question_id IS NOT NULL THEN
    SELECT * INTO cmd
      FROM public.agent_run_commands c
     WHERE c.run_id=p_run_id
       AND c.mode='reply'
       AND c.delivery_state<>'cancelled'
       AND coalesce(c.original_message,c.message)#>>'{metadata,agentQuestionId}'=question_id
       AND coalesce(c.original_message,c.message)->>'content' IS NOT DISTINCT FROM p_message->>'content'
       AND coalesce(c.original_message,c.message)->'metadata'->'agentAnswers' IS NOT DISTINCT FROM p_message->'metadata'->'agentAnswers'
       AND coalesce(c.original_message,c.message)->'attachments' IS NOT DISTINCT FROM p_message->'attachments'
     ORDER BY c.sequence
     LIMIT 1;
    IF FOUND THEN RETURN cmd; END IF;
    IF EXISTS (
      SELECT 1 FROM public.agent_run_commands c
       WHERE c.run_id=p_run_id AND c.mode='reply' AND c.delivery_state<>'cancelled'
         AND coalesce(c.original_message,c.message)#>>'{metadata,agentQuestionId}'=question_id
    ) THEN
      RAISE EXCEPTION 'AGENT_QUESTION_ALREADY_ANSWERED' USING ERRCODE='40001';
    END IF;
  END IF;
  IF r.status NOT IN ('queued','running','awaiting_input') OR r.cancel_requested THEN RAISE EXCEPTION 'AGENT_RUN_CLOSED' USING ERRCODE='22023'; END IF;
  IF p_mode NOT IN ('steer','follow_up','reply') OR p_message->>'role'<>'user' OR coalesce(btrim(p_message->>'content'),'')='' OR length(p_message->>'content')>32000 THEN RAISE EXCEPTION 'AGENT_INVALID_MESSAGE' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM public.agent_run_commands WHERE run_id=p_run_id AND NOT consumed)>=50 THEN RAISE EXCEPTION 'AGENT_QUEUE_FULL' USING ERRCODE='22023'; END IF;
  IF p_mode='reply' AND r.checkpoint->>'questionId' IS NOT NULL AND r.checkpoint->>'questionId' IS DISTINCT FROM p_message#>>'{metadata,agentQuestionId}' THEN RAISE EXCEPTION 'AGENT_QUESTION_CHANGED' USING ERRCODE='40001'; END IF;
  INSERT INTO public.agent_run_commands(run_id,request_id,mode,message,original_message,original_mode,sort_order)
    VALUES(p_run_id,p_request_id,p_mode,p_message,p_message,p_mode,(SELECT coalesce(max(sort_order),0)+1024 FROM public.agent_run_commands WHERE run_id=p_run_id)) RETURNING * INTO cmd;
  -- Pending inputs stay in the business queue until the worker freezes them.
  UPDATE public.agent_runs SET status=CASE WHEN status='awaiting_input' AND p_mode='reply' THEN 'queued' ELSE status END,updated_at=now() WHERE id=p_run_id;
  PERFORM public.agent_emit(p_run_id,'command');
  RETURN cmd;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_sync_message(p_run_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs; messages jsonb; user_message jsonb; versions jsonb; previous_write text;
BEGIN
  PERFORM public.agent_require_admin();
  SELECT * INTO STRICT r FROM public.agent_runs WHERE id=p_run_id;
  SELECT coalesce(c.messages,'[]') INTO messages FROM public.conversations c WHERE c.id=r.conversation_id FOR UPDATE;
  SELECT coalesce(jsonb_agg(CASE WHEN m->>'id'=r.public_message->>'id' THEN r.public_message ELSE m END ORDER BY n),'[]')
    INTO messages FROM jsonb_array_elements(messages) WITH ORDINALITY AS items(m,n);
  IF r.input->>'replaceFromMessageId' IS NOT NULL AND r.status IN ('completed','failed','cancelled') THEN
    SELECT m INTO user_message FROM jsonb_array_elements(messages) t(m) WHERE m->>'id'=r.input#>>'{userMessage,id}';
    versions:=coalesce(user_message->'versions','[]')||jsonb_build_array(jsonb_build_object('userContent',user_message->>'content','attachments',user_message->'attachments','mentions',user_message->'mentions','aiContent',r.public_message->>'content','aiAgent',r.public_message->'agent','aiMetadata',r.public_message->'metadata','createdAt',now()));
    SELECT coalesce(jsonb_agg(CASE WHEN m->>'id'=user_message->>'id' THEN m||jsonb_build_object('versions',versions,'currentVersionIndex',jsonb_array_length(versions)-1) ELSE m END ORDER BY n),'[]') INTO messages FROM jsonb_array_elements(messages) WITH ORDINALITY t(m,n);
  END IF;
  previous_write:=current_setting('taibu.agent_write',true);
  PERFORM set_config('taibu.agent_write','true',true);
  PERFORM public.replace_conversation_messages(r.conversation_id,messages);
  PERFORM set_config('taibu.agent_write',coalesce(previous_write,''),true);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_task_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE event text; heading text; target_message text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('completed','failed','awaiting_input') THEN RETURN NEW; END IF;
  -- A scheduled run that finished has its own notice, named after the schedule
  -- and honouring its owner's notify choice; the generic task notice would
  -- duplicate it. A question still needs the member's attention, so an
  -- awaiting_input run keeps the generic notice even when it belongs to a schedule.
  IF NEW.status IN ('completed','failed') AND EXISTS(SELECT 1 FROM public.agent_schedule_runs WHERE agent_run_id=NEW.id) THEN RETURN NEW; END IF;
  IF NOT coalesce((SELECT notifications_enabled AND notify_site FROM public.user_settings WHERE user_id=NEW.user_id),true) THEN RETURN NEW; END IF;
  event:='agent:'||NEW.id::text||':'||NEW.status||CASE WHEN NEW.status='awaiting_input' THEN ':'||coalesce(NEW.checkpoint->>'questionId','legacy') ELSE '' END;
  heading:=CASE NEW.status WHEN 'completed' THEN '太卜任务完成' WHEN 'failed' THEN '太卜任务未完成' ELSE '太卜需要你补充信息' END;
  target_message:=NEW.public_message->>'id';
  INSERT INTO public.notifications(user_id,type,title,content,link,event_key,event_data)
    VALUES(NEW.user_id,'system',heading,coalesce(NEW.input->>'title','打开对话查看任务'),'/chat?id='||NEW.conversation_id::text||'&message='||coalesce(target_message,''),event,jsonb_build_object('kind','agent','conversationId',NEW.conversation_id,'messageId',target_message,'questionId',NEW.checkpoint->>'questionId','status',NEW.status))
    ON CONFLICT(user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_user_said(p_run public.agent_runs, p_text text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT length(btrim(coalesce(p_text,''))) > 0 AND EXISTS(
    SELECT 1 FROM public.agent_runs ar
    WHERE ar.conversation_id=p_run.conversation_id AND ar.user_id=p_run.user_id
      AND ((ar.input->'userMessage'->>'role'='user' AND strpos(coalesce(ar.input->'userMessage'->>'content',''),p_text)>0)
        OR EXISTS(SELECT 1 FROM public.agent_run_commands c WHERE c.run_id=ar.id AND c.message->>'role'='user'
          AND c.delivery_state IN ('admitted','consumed') AND strpos(coalesce(c.message->>'content',''),p_text)>0)));
$$;

CREATE OR REPLACE FUNCTION public.agent_worker_heartbeat(p_worker_id text, p_engine text DEFAULT 'pi-durable/1.5.0'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.agent_require_admin();
  IF p_engine IS DISTINCT FROM 'pi-durable/1.5.0' THEN
    RAISE EXCEPTION 'AGENT_ENGINE_UNSUPPORTED' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.agent_workers(id,heartbeat_at,engine) VALUES(p_worker_id,now(),p_engine)
    ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at,engine=excluded.engine;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_write_memory(p_run_id uuid, p_worker_id text, p_fence bigint, p_title text, p_content text, p_kind text, p_evidence text) RETURNS public.user_agent_memory
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r public.agent_runs; m public.user_agent_memory;
BEGIN
  r:=public.agent_require_lease(p_run_id,p_worker_id,p_fence);
  IF r.cancel_requested THEN RAISE EXCEPTION 'AGENT_CANCELLED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_settings WHERE user_id=r.user_id AND chat_preferences->>'memoryEnabled'='true') THEN RAISE EXCEPTION 'AGENT_MEMORY_DISABLED'; END IF;
  IF p_evidence IS NULL OR p_content IS NULL OR p_title IS NULL OR length(btrim(p_evidence))<8 OR length(p_evidence)>500 OR btrim(p_content)<>btrim(p_evidence) OR ((r.input->'userMessage'->>'role' IS DISTINCT FROM 'user' OR strpos(coalesce(r.input->'userMessage'->>'content',''),p_evidence)=0) AND NOT EXISTS(SELECT 1 FROM public.agent_run_commands WHERE run_id=r.id AND message->>'role'='user' AND delivery_state IN ('admitted','consumed') AND strpos(message->>'content',p_evidence)>0)) THEN RAISE EXCEPTION 'AGENT_MEMORY_EVIDENCE_REQUIRED'; END IF;
  INSERT INTO public.user_agent_memory(user_id,title,content,kind,source_run_id,source_text)
  VALUES(r.user_id,btrim(p_title),btrim(p_content),p_kind,r.id,p_evidence)
  ON CONFLICT(user_id,fingerprint) DO UPDATE SET title=excluded.title,kind=excluded.kind,source_run_id=excluded.source_run_id,source_text=excluded.source_text,updated_at=now()
  RETURNING * INTO m;
  RETURN m;
END;
$$;

CREATE OR REPLACE FUNCTION public.batch_update_vectors(p_updates jsonb, p_expected_dim integer DEFAULT 1536, p_force_overwrite boolean DEFAULT false) RETURNS TABLE(updated_count integer, skipped_count integer, already_exists_count integer, error_details jsonb)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $_$
DECLARE
    v_user_id UUID;
    v_update JSONB;
    v_entry_id UUID;
    v_vector_jsonb JSONB;
    v_vector_arr float8[];
    v_vector vector;
    v_updated INT := 0;
    v_skipped INT := 0;
    v_already_exists INT := 0;
    v_errors JSONB := '[]'::jsonb;
    v_dim INT;
    v_elem JSONB;
    v_elem_text TEXT;
    v_elem_type TEXT;
    v_has_invalid_elem BOOLEAN;
    v_invalid_elem_info TEXT;
    v_ord INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
    LOOP
        v_entry_id := (v_update->>'id')::uuid;
        v_vector_jsonb := v_update->'content_vector';

        IF v_vector_jsonb IS NULL THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'content_vector is NULL');
            CONTINUE;
        END IF;

        IF jsonb_typeof(v_vector_jsonb) = 'null' THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'content_vector is JSON null');
            CONTINUE;
        END IF;

        IF jsonb_typeof(v_vector_jsonb) != 'array' THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object(
                'id', v_entry_id,
                'reason', 'content_vector is not an array',
                'actual_type', jsonb_typeof(v_vector_jsonb)
            );
            CONTINUE;
        END IF;

        IF jsonb_array_length(v_vector_jsonb) = 0 THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'content_vector is empty array');
            CONTINUE;
        END IF;

        v_has_invalid_elem := FALSE;
        v_invalid_elem_info := NULL;
        v_ord := 0;

        FOR v_elem IN SELECT value FROM jsonb_array_elements(v_vector_jsonb)
        LOOP
            v_ord := v_ord + 1;
            v_elem_type := jsonb_typeof(v_elem);

            IF v_elem_type = 'null' THEN
                v_has_invalid_elem := TRUE;
                v_invalid_elem_info := format('element[%s] is null', v_ord - 1);
                EXIT;
            END IF;

            IF v_elem_type NOT IN ('number') THEN
                v_has_invalid_elem := TRUE;
                v_invalid_elem_info := format('element[%s] is %s, expected number', v_ord - 1, v_elem_type);
                EXIT;
            END IF;

            v_elem_text := v_elem::text;
            IF v_elem_text IN ('NaN', 'Infinity', '-Infinity', 'null')
               OR v_elem_text !~ '^-?[0-9]+[.]?[0-9]*([eE][+-]?[0-9]+)?$' THEN
                v_has_invalid_elem := TRUE;
                v_invalid_elem_info := format('element[%s] is invalid: %s', v_ord - 1, v_elem_text);
                EXIT;
            END IF;
        END LOOP;

        IF v_has_invalid_elem THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object(
                'id', v_entry_id,
                'reason', 'invalid_element',
                'detail', v_invalid_elem_info
            );
            CONTINUE;
        END IF;

        SELECT array_agg(t.val::float8 ORDER BY t.ord)
        INTO v_vector_arr
        FROM jsonb_array_elements_text(v_vector_jsonb) WITH ORDINALITY AS t(val, ord);

        IF EXISTS (SELECT 1 FROM unnest(v_vector_arr) AS x WHERE x IS NULL OR x IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)) THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'vector contains non-finite values');
            CONTINUE;
        END IF;

        v_dim := array_length(v_vector_arr, 1);
        IF v_dim != p_expected_dim THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object(
                'id', v_entry_id,
                'reason', 'dimension mismatch',
                'expected', p_expected_dim,
                'actual', v_dim
            );
            CONTINUE;
        END IF;

        v_vector := v_vector_arr::vector;

        IF p_force_overwrite THEN
            UPDATE public.knowledge_entries e
            SET
                content_vector = v_vector,
                metadata = e.metadata || COALESCE(v_update->'metadata', '{}'::jsonb)
            FROM public.knowledge_bases kb
            WHERE e.id = v_entry_id
              AND e.kb_id = kb.id
              AND kb.user_id = v_user_id;
        ELSE
            UPDATE public.knowledge_entries e
            SET
                content_vector = v_vector,
                metadata = e.metadata || COALESCE(v_update->'metadata', '{}'::jsonb)
            FROM public.knowledge_bases kb
            WHERE e.id = v_entry_id
              AND e.kb_id = kb.id
              AND kb.user_id = v_user_id
              AND e.content_vector IS NULL;
        END IF;

        IF FOUND THEN
            v_updated := v_updated + 1;
        ELSE
            IF NOT p_force_overwrite AND EXISTS (
                SELECT 1 FROM public.knowledge_entries e
                JOIN public.knowledge_bases kb ON e.kb_id = kb.id
                WHERE e.id = v_entry_id
                  AND kb.user_id = v_user_id
                  AND e.content_vector IS NOT NULL
            ) THEN
                v_already_exists := v_already_exists + 1;
            ELSE
                v_skipped := v_skipped + 1;
                v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'entry not found or not owned');
            END IF;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_updated, v_skipped, v_already_exists, v_errors;
END;
$_$;

CREATE OR REPLACE FUNCTION public.batch_update_vectors_as_service(p_updates jsonb, p_user_id uuid, p_expected_dim integer DEFAULT 1536, p_force_overwrite boolean DEFAULT false) RETURNS TABLE(updated_count integer, skipped_count integer, already_exists_count integer, error_details jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $_$
DECLARE
    v_update JSONB;
    v_entry_id UUID;
    v_vector_jsonb JSONB;
    v_vector_arr float8[];
    v_vector vector;
    v_updated INT := 0;
    v_skipped INT := 0;
    v_already_exists INT := 0;
    v_errors JSONB := '[]'::jsonb;
    v_dim INT;
    v_elem JSONB;
    v_elem_text TEXT;
    v_elem_type TEXT;
    v_has_invalid_elem BOOLEAN;
    v_invalid_elem_info TEXT;
    v_ord INT;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;

    -- Owners backfill their own entries; administrators may act for anyone.
    IF auth.uid() IS DISTINCT FROM p_user_id AND NOT public.is_admin_user() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
    LOOP
        v_entry_id := (v_update->>'id')::uuid;
        v_vector_jsonb := v_update->'content_vector';

        IF v_vector_jsonb IS NULL THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'content_vector is NULL');
            CONTINUE;
        END IF;

        IF jsonb_typeof(v_vector_jsonb) = 'null' THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'content_vector is JSON null');
            CONTINUE;
        END IF;

        IF jsonb_typeof(v_vector_jsonb) != 'array' THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object(
                'id', v_entry_id,
                'reason', 'content_vector is not an array',
                'actual_type', jsonb_typeof(v_vector_jsonb)
            );
            CONTINUE;
        END IF;

        IF jsonb_array_length(v_vector_jsonb) = 0 THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'content_vector is empty array');
            CONTINUE;
        END IF;

        v_has_invalid_elem := FALSE;
        v_invalid_elem_info := NULL;
        v_ord := 0;

        FOR v_elem IN SELECT value FROM jsonb_array_elements(v_vector_jsonb)
        LOOP
            v_ord := v_ord + 1;
            v_elem_type := jsonb_typeof(v_elem);

            IF v_elem_type = 'null' THEN
                v_has_invalid_elem := TRUE;
                v_invalid_elem_info := format('element[%s] is null', v_ord - 1);
                EXIT;
            END IF;

            IF v_elem_type NOT IN ('number') THEN
                v_has_invalid_elem := TRUE;
                v_invalid_elem_info := format('element[%s] is %s, expected number', v_ord - 1, v_elem_type);
                EXIT;
            END IF;

            v_elem_text := v_elem::text;
            IF v_elem_text IN ('NaN', 'Infinity', '-Infinity', 'null')
               OR v_elem_text !~ '^-?[0-9]+[.]?[0-9]*([eE][+-]?[0-9]+)?$' THEN
                v_has_invalid_elem := TRUE;
                v_invalid_elem_info := format('element[%s] is invalid: %s', v_ord - 1, v_elem_text);
                EXIT;
            END IF;
        END LOOP;

        IF v_has_invalid_elem THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object(
                'id', v_entry_id,
                'reason', 'invalid_element',
                'detail', v_invalid_elem_info
            );
            CONTINUE;
        END IF;

        SELECT array_agg(t.val::float8 ORDER BY t.ord)
        INTO v_vector_arr
        FROM jsonb_array_elements_text(v_vector_jsonb) WITH ORDINALITY AS t(val, ord);

        IF EXISTS (SELECT 1 FROM unnest(v_vector_arr) AS x WHERE x IS NULL OR x IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)) THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'vector contains non-finite values');
            CONTINUE;
        END IF;

        v_dim := array_length(v_vector_arr, 1);
        IF v_dim != p_expected_dim THEN
            v_skipped := v_skipped + 1;
            v_errors := v_errors || jsonb_build_object(
                'id', v_entry_id,
                'reason', 'dimension mismatch',
                'expected', p_expected_dim,
                'actual', v_dim
            );
            CONTINUE;
        END IF;

        v_vector := v_vector_arr::vector;

        IF p_force_overwrite THEN
            UPDATE public.knowledge_entries e
            SET
                content_vector = v_vector,
                metadata = e.metadata || COALESCE(v_update->'metadata', '{}'::jsonb)
            FROM public.knowledge_bases kb
            WHERE e.id = v_entry_id
              AND e.kb_id = kb.id
              AND kb.user_id = p_user_id;
        ELSE
            UPDATE public.knowledge_entries e
            SET
                content_vector = v_vector,
                metadata = e.metadata || COALESCE(v_update->'metadata', '{}'::jsonb)
            FROM public.knowledge_bases kb
            WHERE e.id = v_entry_id
              AND e.kb_id = kb.id
              AND kb.user_id = p_user_id
              AND e.content_vector IS NULL;
        END IF;

        IF FOUND THEN
            v_updated := v_updated + 1;
        ELSE
            IF NOT p_force_overwrite AND EXISTS (
                SELECT 1 FROM public.knowledge_entries e
                JOIN public.knowledge_bases kb ON e.kb_id = kb.id
                WHERE e.id = v_entry_id
                  AND kb.user_id = p_user_id
                  AND e.content_vector IS NOT NULL
            ) THEN
                v_already_exists := v_already_exists + 1;
            ELSE
                v_skipped := v_skipped + 1;
                v_errors := v_errors || jsonb_build_object('id', v_entry_id, 'reason', 'entry not found or not owned');
            END IF;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_updated, v_skipped, v_already_exists, v_errors;
END;
$_$;

-- Creates the wallet on first use and locks it: every balance change for one
-- member is serialized on this row, allowances included.
CREATE OR REPLACE FUNCTION public.billing_lock_account(p_user_id uuid) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE balance bigint;
BEGIN
  INSERT INTO public.billing_accounts(user_id) VALUES(p_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT balance_micros INTO STRICT balance FROM public.billing_accounts WHERE user_id=p_user_id FOR UPDATE;
  RETURN balance;
END;
$$;

-- The first reset boundary after p_after, counted from the start so month ends
-- do not drift; NULL when the allowance never resets or the boundary reaches the end.
CREATE OR REPLACE FUNCTION public.billing_next_reset(p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_period text, p_after timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE steps integer; step interval; candidate timestamp with time zone;
BEGIN
  IF p_period NOT IN ('five_hour','daily','weekly','monthly') THEN RETURN NULL; END IF;
  step := CASE p_period WHEN 'monthly' THEN interval '1 month' WHEN 'weekly' THEN interval '7 days'
    WHEN 'five_hour' THEN interval '5 hours' ELSE interval '1 day' END;
  steps := greatest(CASE p_period
    WHEN 'monthly' THEN (extract(year FROM age(p_after,p_starts_at))*12 + extract(month FROM age(p_after,p_starts_at)))::integer
    ELSE floor(extract(epoch FROM p_after-p_starts_at)/extract(epoch FROM step))::integer END, 1);
  LOOP
    candidate := p_starts_at + step*steps;
    EXIT WHEN candidate > p_after;
    steps := steps + 1;
  END LOOP;
  RETURN CASE WHEN candidate < p_ends_at THEN candidate END;
END;
$$;

-- Applies a reset that has come due to one locked allowance window.
CREATE OR REPLACE FUNCTION public.billing_apply_limit_reset(p_limit public.user_subscription_limits) RETURNS public.user_subscription_limits
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE sub public.user_subscriptions;
BEGIN
  IF p_limit.next_reset_at IS NULL OR p_limit.next_reset_at > now() THEN RETURN p_limit; END IF;
  SELECT * INTO sub FROM public.user_subscriptions WHERE id=p_limit.subscription_id;
  UPDATE public.user_subscription_limits SET used_micros=0,
    next_reset_at=public.billing_next_reset(sub.starts_at,sub.ends_at,p_limit.period,now())
    WHERE subscription_id=p_limit.subscription_id AND period=p_limit.period RETURNING * INTO p_limit;
  RETURN p_limit;
END;
$$;

-- Starts a subscription from a plan now. The title and every allowance window
-- are copied, so a later edit of the plan does not change what was sold.
CREATE OR REPLACE FUNCTION public.billing_open_subscription(p_user_id uuid, p_plan public.subscription_plans, p_source text, p_order_id uuid, p_note text) RETURNS public.user_subscriptions
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE sub public.user_subscriptions; starts timestamp with time zone := now(); ends timestamp with time zone; lim record;
BEGIN
  ends := starts + CASE p_plan.duration_unit
    WHEN 'day' THEN make_interval(days=>p_plan.duration_value)
    WHEN 'month' THEN make_interval(months=>p_plan.duration_value)
    ELSE make_interval(years=>p_plan.duration_value) END;
  INSERT INTO public.user_subscriptions(user_id,plan_id,title,starts_at,ends_at,source,order_id,note)
    VALUES(p_user_id,p_plan.id,p_plan.title,starts,ends,p_source,p_order_id,p_note)
    RETURNING * INTO sub;
  FOR lim IN SELECT * FROM public.subscription_plan_limits WHERE plan_id=p_plan.id LOOP
    INSERT INTO public.user_subscription_limits(subscription_id,period,allowance_micros,next_reset_at)
      VALUES(sub.id,lim.period,lim.allowance_micros,public.billing_next_reset(starts,ends,lim.period,starts));
  END LOOP;
  RETURN sub;
END;
$$;

-- What the member can spend now: the wallet plus every active allowance, an
-- allowance whose reset is due counting as full again.
CREATE OR REPLACE FUNCTION public.billing_spendable(p_user_id uuid) RETURNS bigint
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_user_id IS NULL OR (p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN coalesce((SELECT balance_micros FROM public.billing_accounts WHERE user_id=p_user_id),0)
    + coalesce((SELECT sum(CASE WHEN l.next_reset_at<=now() THEN l.allowance_micros ELSE l.allowance_micros-l.used_micros END)
        FROM public.user_subscription_limits l JOIN public.user_subscriptions s ON s.id=l.subscription_id
        WHERE s.user_id=p_user_id AND s.status='active' AND s.starts_at<=now() AND s.ends_at>now()),0);
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_summary(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE wallet bigint; remaining bigint; subscriptions jsonb;
BEGIN
  IF p_user_id IS NULL OR (p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  wallet := coalesce((SELECT balance_micros FROM public.billing_accounts WHERE user_id=p_user_id),0);
  SELECT coalesce(sum(u.allowance-u.used),0), coalesce(jsonb_agg(u.subscription ORDER BY u.ends_at,u.id),'[]'::jsonb)
    INTO remaining, subscriptions
    FROM (SELECT s.id,s.ends_at,
        jsonb_build_object('id',s.id,'planId',s.plan_id,'title',s.title,'source',s.source,
          'startsAt',s.starts_at,'endsAt',s.ends_at,'limits',jsonb_agg(jsonb_build_object(
            'period',l.period,'allowanceMicros',l.allowance,'usedMicros',l.used,'nextResetAt',l.next_reset) ORDER BY CASE l.period WHEN 'five_hour' THEN 1 WHEN 'daily' THEN 2 WHEN 'weekly' THEN 3 WHEN 'monthly' THEN 4 ELSE 5 END)) AS subscription,
        sum(l.allowance) AS allowance, sum(l.used) AS used
      FROM public.user_subscriptions s CROSS JOIN LATERAL (
        SELECT l.period,l.allowance_micros AS allowance,
          CASE WHEN l.next_reset_at<=now() THEN 0 ELSE l.used_micros END AS used,
          CASE WHEN l.next_reset_at<=now() THEN public.billing_next_reset(s.starts_at,s.ends_at,l.period,now()) ELSE l.next_reset_at END AS next_reset
        FROM public.user_subscription_limits l WHERE l.subscription_id=s.id) l
      WHERE s.user_id=p_user_id AND s.status='active' AND s.starts_at<=now() AND s.ends_at>now()
      GROUP BY s.id,s.plan_id,s.title,s.source,s.starts_at,s.ends_at) u;
  RETURN jsonb_build_object('walletMicros',wallet,'subscriptionMicros',remaining,
    'spendableMicros',wallet+remaining,
    'deductOrder',coalesce((SELECT deduct_order FROM public.billing_accounts WHERE user_id=p_user_id),'subscription'),
    'subscriptions',subscriptions);
END;
$$;

-- Meters one usage charge: active allowances first, soonest to end first and
-- after any due reset, then the wallet. With p_allow_debt the wallet may go
-- negative for usage that already happened; a prepaid charge never does. A
-- repeated idempotency key returns the entry it recorded.
CREATE OR REPLACE FUNCTION public.billing_charge(p_user_id uuid, p_amount bigint, p_allow_debt boolean, p_source text, p_model_key text DEFAULT NULL::text, p_usage jsonb DEFAULT NULL::jsonb, p_reference_type text DEFAULT NULL::text, p_reference_id text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_description text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE entry public.billing_ledger; sub public.user_subscriptions; lim public.user_subscription_limits;
  wallet bigint; remaining bigint; take bigint; parts jsonb := '[]'; prefer text; from_wallet bigint := 0; affordable bigint;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_amount IS NULL OR p_amount<0 THEN RAISE EXCEPTION 'BILLING_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
  wallet := public.billing_lock_account(p_user_id);
  SELECT deduct_order INTO STRICT prefer FROM public.billing_accounts WHERE user_id=p_user_id;
  -- Checked under the lock, so a concurrent duplicate has committed by now.
  SELECT * INTO entry FROM public.billing_ledger WHERE idempotency_key=p_idempotency_key AND user_id=p_user_id;
  IF FOUND THEN RETURN to_jsonb(entry)||jsonb_build_object('replayed',true); END IF;
  remaining := p_amount;
  -- 先扣余额时，预付的调用要先把总额看住：余额与各份额度的剩余加起来不够就一笔都不动。
  IF NOT p_allow_debt AND prefer='wallet' THEN
    SELECT greatest(wallet,0)+coalesce(sum(CASE WHEN l.next_reset_at<=now() THEN l.allowance_micros ELSE l.allowance_micros-l.used_micros END),0)
      INTO affordable FROM public.user_subscriptions s JOIN public.user_subscription_limits l ON l.subscription_id=s.id
      WHERE s.user_id=p_user_id AND s.status='active' AND s.starts_at<=now() AND s.ends_at>now();
    IF coalesce(affordable,greatest(wallet,0)) < remaining THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE='P0001'; END IF;
  END IF;
  IF prefer='wallet' THEN
    take := least(remaining,greatest(wallet,0));
    IF take>0 THEN
      wallet := wallet-take;
      from_wallet := take;
      remaining := remaining-take;
      UPDATE public.billing_accounts SET balance_micros=wallet,updated_at=now() WHERE user_id=p_user_id;
    END IF;
  END IF;
  FOR sub IN SELECT * FROM public.user_subscriptions
      WHERE user_id=p_user_id AND status='active' AND starts_at<=now() AND ends_at>now()
      ORDER BY ends_at,created_at,id FOR UPDATE LOOP
    EXIT WHEN remaining=0;
    -- 窗口从短到长：最先重置的额度先用掉。
    FOR lim IN SELECT * FROM public.user_subscription_limits WHERE subscription_id=sub.id
        ORDER BY CASE period WHEN 'five_hour' THEN 1 WHEN 'daily' THEN 2 WHEN 'weekly' THEN 3 WHEN 'monthly' THEN 4 ELSE 5 END
        FOR UPDATE LOOP
      EXIT WHEN remaining=0;
      lim := public.billing_apply_limit_reset(lim);
      take := least(remaining,lim.allowance_micros-lim.used_micros);
      CONTINUE WHEN take<=0;
      UPDATE public.user_subscription_limits SET used_micros=used_micros+take
        WHERE subscription_id=lim.subscription_id AND period=lim.period;
      parts := parts||jsonb_build_array(jsonb_build_object('id',sub.id,'title',sub.title,'period',lim.period,'micros',-take));
      remaining := remaining-take;
    END LOOP;
  END LOOP;
  IF remaining>0 THEN
    IF NOT p_allow_debt AND wallet<remaining THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE='P0001'; END IF;
    wallet := wallet-remaining;
    from_wallet := from_wallet+remaining;
    UPDATE public.billing_accounts SET balance_micros=wallet,updated_at=now() WHERE user_id=p_user_id;
  END IF;
  INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_micros,subscription_parts,wallet_after_micros,
      source,model_key,usage,reference_type,reference_id,idempotency_key,description)
    VALUES(p_user_id,'usage',-p_amount,-from_wallet,parts,wallet,coalesce(p_source,''),p_model_key,p_usage,
      p_reference_type,p_reference_id,p_idempotency_key,left(coalesce(p_description,''),500))
    RETURNING * INTO entry;
  RETURN to_jsonb(entry)||jsonb_build_object('replayed',false);
END;
$$;

-- Which purse a charge spends first: the allowances (soonest ending first, the
-- default) or the wallet. A member may set their own, an administrator anyone's.
CREATE OR REPLACE FUNCTION public.billing_set_deduct_order(p_user_id uuid, p_order text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_user_id IS NULL OR (p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_order IS NULL OR p_order NOT IN ('subscription','wallet') THEN RAISE EXCEPTION 'BILLING_ORDER_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO public.billing_accounts(user_id) VALUES(p_user_id) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.billing_accounts SET deduct_order=p_order,updated_at=now() WHERE user_id=p_user_id;
  RETURN p_order;
END;
$$;

-- Returns part or all of a usage charge in reverse order: the wallet share
-- first, then the allowances last to first. An allowance that has since reset
-- or ended cannot take its share back; that share lapses with it.
CREATE OR REPLACE FUNCTION public.billing_refund(p_charge_key text, p_amount bigint, p_idempotency_key text, p_description text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE charge public.billing_ledger; entry public.billing_ledger; sub public.user_subscriptions;
  lim public.user_subscription_limits; part jsonb;
  wallet bigint; due bigint; wallet_back bigint; restore bigint; restored bigint := 0; parts jsonb := '[]';
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_idempotency_key IS NULL THEN RAISE EXCEPTION 'BILLING_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO charge FROM public.billing_ledger WHERE idempotency_key=p_charge_key AND kind='usage';
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_CHARGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  wallet := public.billing_lock_account(charge.user_id);
  SELECT * INTO entry FROM public.billing_ledger WHERE idempotency_key=p_idempotency_key AND user_id=charge.user_id;
  IF FOUND THEN RETURN to_jsonb(entry)||jsonb_build_object('replayed',true); END IF;
  wallet_back := greatest(least(p_amount, -charge.wallet_micros - coalesce((SELECT sum(l.wallet_micros) FROM public.billing_ledger l
    WHERE l.kind='refund' AND l.reference_type='billing_ledger' AND l.reference_id=charge.id::text),0)),0);
  due := p_amount-wallet_back;
  FOR part IN SELECT t.value FROM jsonb_array_elements(charge.subscription_parts) WITH ORDINALITY t(value,n) ORDER BY t.n DESC LOOP
    EXIT WHEN due=0;
    restore := least(due, -(part->>'micros')::bigint - coalesce((SELECT sum((p.value->>'micros')::bigint)
      FROM public.billing_ledger l CROSS JOIN LATERAL jsonb_array_elements(l.subscription_parts) p
      WHERE l.kind='refund' AND l.reference_type='billing_ledger' AND l.reference_id=charge.id::text
        AND p.value->>'id'=part->>'id' AND p.value->>'period'=part->>'period'),0));
    CONTINUE WHEN restore<=0;
    SELECT * INTO sub FROM public.user_subscriptions
      WHERE id=(part->>'id')::uuid AND status='active' AND ends_at>now() FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    SELECT * INTO lim FROM public.user_subscription_limits
      WHERE subscription_id=sub.id AND period=coalesce(part->>'period','total') FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    lim := public.billing_apply_limit_reset(lim);
    restore := least(restore,lim.used_micros);
    CONTINUE WHEN restore<=0;
    UPDATE public.user_subscription_limits SET used_micros=used_micros-restore
      WHERE subscription_id=lim.subscription_id AND period=lim.period;
    parts := parts||jsonb_build_array(jsonb_build_object('id',sub.id,'title',sub.title,'period',lim.period,'micros',restore));
    restored := restored+restore;
    due := due-restore;
  END LOOP;
  IF wallet_back+restored=0 THEN RETURN NULL; END IF;
  IF wallet_back>0 THEN
    wallet := wallet+wallet_back;
    UPDATE public.billing_accounts SET balance_micros=wallet,updated_at=now() WHERE user_id=charge.user_id;
  END IF;
  INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_micros,subscription_parts,wallet_after_micros,
      source,model_key,reference_type,reference_id,idempotency_key,description)
    VALUES(charge.user_id,'refund',wallet_back+restored,wallet_back,parts,wallet,charge.source,charge.model_key,
      'billing_ledger',charge.id::text,p_idempotency_key,left(coalesce(p_description,''),500))
    RETURNING * INTO entry;
  RETURN to_jsonb(entry)||jsonb_build_object('replayed',false);
END;
$$;

-- An administrator's manual credit or debit. A debit may not take the wallet below zero.
CREATE OR REPLACE FUNCTION public.billing_adjust_wallet(p_user_id uuid, p_amount bigint, p_description text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE entry public.billing_ledger; wallet bigint;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_amount IS NULL OR p_amount=0 THEN RAISE EXCEPTION 'BILLING_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
  wallet := public.billing_lock_account(p_user_id);
  IF p_amount<0 AND wallet+p_amount<0 THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE='P0001'; END IF;
  wallet := wallet+p_amount;
  UPDATE public.billing_accounts SET balance_micros=wallet,updated_at=now() WHERE user_id=p_user_id;
  INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_micros,wallet_after_micros,source,reference_type,reference_id,description)
    VALUES(p_user_id,'adjust',p_amount,p_amount,wallet,'admin','user',auth.uid()::text,left(coalesce(p_description,''),500))
    RETURNING * INTO entry;
  RETURN to_jsonb(entry);
END;
$$;

-- An administrator gives a plan; the per-member purchase limit does not apply.
CREATE OR REPLACE FUNCTION public.billing_grant_subscription(p_user_id uuid, p_plan_id uuid, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE plan public.subscription_plans; sub public.user_subscriptions; wallet bigint;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  wallet := public.billing_lock_account(p_user_id);
  SELECT * INTO plan FROM public.subscription_plans WHERE id=p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_PLAN_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  sub := public.billing_open_subscription(p_user_id,plan,'admin',NULL,p_note);
  INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_after_micros,source,reference_type,reference_id,description)
    VALUES(p_user_id,'subscription',0,wallet,'admin','user_subscription',sub.id::text,format('管理员开通「%s」',plan.title));
  RETURN to_jsonb(sub);
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_cancel_subscription(p_subscription_id uuid, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE owner_id uuid; sub public.user_subscriptions; wallet bigint;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT user_id INTO owner_id FROM public.user_subscriptions WHERE id=p_subscription_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  wallet := public.billing_lock_account(owner_id);
  UPDATE public.user_subscriptions SET status='cancelled',note=coalesce(p_note,note),updated_at=now()
    WHERE id=p_subscription_id AND status='active' RETURNING * INTO sub;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_NOT_ACTIVE' USING ERRCODE='22023'; END IF;
  INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_after_micros,source,reference_type,reference_id,description)
    VALUES(owner_id,'subscription',0,wallet,'admin','user_subscription',sub.id::text,format('管理员取消「%s」',sub.title));
  RETURN to_jsonb(sub);
END;
$$;

-- The member buys a plan with the wallet. Never on credit: the price must be covered.
CREATE OR REPLACE FUNCTION public.billing_buy_plan_with_balance(p_user_id uuid, p_plan_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE plan public.subscription_plans; sub public.user_subscriptions; entry public.billing_ledger; wallet bigint; price bigint;
BEGIN
  IF p_user_id IS NULL OR (p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  wallet := public.billing_lock_account(p_user_id);
  SELECT * INTO plan FROM public.subscription_plans WHERE id=p_plan_id AND enabled AND purchasable;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_PLAN_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
  IF plan.max_per_user IS NOT NULL
     AND (SELECT count(*) FROM public.user_subscriptions WHERE user_id=p_user_id AND plan_id=plan.id)>=plan.max_per_user THEN
    RAISE EXCEPTION 'BILLING_PLAN_LIMIT' USING ERRCODE='23505';
  END IF;
  price := round(plan.price_usd*1000000)::bigint;
  IF wallet<price THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE='P0001'; END IF;
  wallet := wallet-price;
  UPDATE public.billing_accounts SET balance_micros=wallet,updated_at=now() WHERE user_id=p_user_id;
  sub := public.billing_open_subscription(p_user_id,plan,'balance',NULL,NULL);
  INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_micros,wallet_after_micros,source,reference_type,reference_id,description)
    VALUES(p_user_id,'subscription',-price,-price,wallet,'balance','user_subscription',sub.id::text,format('余额购买「%s」',plan.title))
    RETURNING * INTO entry;
  RETURN jsonb_build_object('subscription',to_jsonb(sub),'entry',to_jsonb(entry));
END;
$$;

-- Redeems a code once: balance into the wallet, or a plan started now.
CREATE OR REPLACE FUNCTION public.billing_redeem(p_user_id uuid, p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE code public.redemption_codes; plan public.subscription_plans; sub public.user_subscriptions; entry public.billing_ledger; wallet bigint;
BEGIN
  IF p_user_id IS NULL OR (p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO code FROM public.redemption_codes c WHERE c.code=btrim(coalesce(p_code,'')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REDEMPTION_CODE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF code.status='used' THEN RAISE EXCEPTION 'REDEMPTION_CODE_USED' USING ERRCODE='23505'; END IF;
  IF code.status<>'unused' OR code.expires_at<=now() THEN RAISE EXCEPTION 'REDEMPTION_CODE_UNAVAILABLE' USING ERRCODE='22023'; END IF;
  wallet := public.billing_lock_account(p_user_id);
  IF code.kind='balance' THEN
    wallet := wallet+code.amount_micros;
    UPDATE public.billing_accounts SET balance_micros=wallet,updated_at=now() WHERE user_id=p_user_id;
    INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_micros,wallet_after_micros,source,reference_type,reference_id,description)
      VALUES(p_user_id,'redeem',code.amount_micros,code.amount_micros,wallet,'code','redemption_code',code.id::text,'兑换码充值')
      RETURNING * INTO entry;
  ELSE
    SELECT * INTO STRICT plan FROM public.subscription_plans WHERE id=code.plan_id;
    sub := public.billing_open_subscription(p_user_id,plan,'redeem',NULL,NULL);
    INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_after_micros,source,reference_type,reference_id,description)
      VALUES(p_user_id,'redeem',0,wallet,'code','redemption_code',code.id::text,format('兑换「%s」',plan.title))
      RETURNING * INTO entry;
  END IF;
  UPDATE public.redemption_codes SET status='used',used_by=p_user_id,used_at=now() WHERE id=code.id;
  RETURN jsonb_build_object('kind',code.kind,'entry',to_jsonb(entry),'subscription',to_jsonb(sub));
END;
$$;

-- Maintenance: marks ended subscriptions and abandoned checkouts. Spending
-- already ignores both; this keeps the stored status truthful.
CREATE OR REPLACE FUNCTION public.billing_expire_due(p_limit integer DEFAULT 500) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE subscriptions integer; orders integer;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  WITH ended AS (
    UPDATE public.user_subscriptions SET status='expired',updated_at=now() WHERE id IN (
      SELECT id FROM public.user_subscriptions WHERE status='active' AND ends_at<=now()
      ORDER BY ends_at LIMIT least(greatest(p_limit,1),5000) FOR UPDATE SKIP LOCKED)
    RETURNING id)
  SELECT count(*) INTO subscriptions FROM ended;
  WITH abandoned AS (
    UPDATE public.payment_orders SET status='expired',updated_at=now() WHERE id IN (
      SELECT id FROM public.payment_orders WHERE status='pending' AND created_at<now()-interval '2 hours'
      ORDER BY created_at LIMIT least(greatest(p_limit,1),5000) FOR UPDATE SKIP LOCKED)
    RETURNING id)
  SELECT count(*) INTO orders FROM abandoned;
  RETURN jsonb_build_object('subscriptions',subscriptions,'orders',orders);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_vector_index_exists(p_dim integer DEFAULT NULL::integer) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and i.indisvalid and i.indisready
      and ((p_dim is not null and c.relname = 'knowledge_entries_vector_' || p_dim || '_hnsw_idx')
        or (p_dim is null and c.relname like 'knowledge_entries_vector_%_hnsw_idx'))
  );
$$;

CREATE OR REPLACE FUNCTION public.claim_agent_attachment_cleanup(p_limit integer DEFAULT 50) RETURNS SETOF public.agent_attachments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
 PERFORM public.agent_require_admin();
 RETURN QUERY UPDATE public.agent_attachments SET status='deleting' WHERE id IN (
   SELECT a.id FROM public.agent_attachments a WHERE (a.status='deleting' OR a.orphaned_at<now()-interval '24 hours') AND NOT EXISTS(SELECT 1 FROM public.agent_attachment_refs r WHERE r.attachment_id=a.id)
   ORDER BY a.created_at LIMIT least(greatest(p_limit,1),100) FOR UPDATE SKIP LOCKED
 ) RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_notification_popup(p_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE affected integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  UPDATE public.notifications SET popup_claimed_at=now() WHERE id=p_id AND user_id=auth.uid() AND NOT is_read AND popup_claimed_at IS NULL AND event_key IS NOT NULL;
  GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_prompt_enhancement() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE affected integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.prompt_enhancement_usage(user_id,local_date,calls) VALUES(auth.uid(),(now() AT TIME ZONE 'Asia/Shanghai')::date,1)
  ON CONFLICT(user_id,local_date) DO UPDATE SET calls=prompt_enhancement_usage.calls+1 WHERE prompt_enhancement_usage.calls<5;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected=1;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_identity_rows(p_limit integer DEFAULT 5000) RETURNS TABLE(sessions_deleted bigint, verifications_deleted bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'identity', 'public', 'pg_temp'
    AS $$
declare
  v_sessions bigint;
  v_verifications bigint;
begin
  if not public.is_admin_user() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from identity.sessions
  where id in (
    select id from identity.sessions where expires_at < now() - interval '1 day' limit p_limit
  );
  get diagnostics v_sessions = row_count;
  delete from identity.verifications
  where id in (
    select id from identity.verifications where expires_at < now() - interval '1 day' limit p_limit
  );
  get diagnostics v_verifications = row_count;
  return query select v_sessions, v_verifications;
end;
$$;

CREATE OR REPLACE FUNCTION public.create_analysis_conversation_with_history_as_service(p_user_id uuid, p_source_type text, p_source_data jsonb, p_title text, p_messages jsonb, p_history_type text, p_history_payload jsonb) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_history_type NOT IN ('meihua', 'xiaoliuren') THEN
    RETURN public.create_analysis_conversation_with_history_legacy_as_service(
      p_user_id,
      p_source_type,
      p_source_data,
      p_title,
      p_messages,
      p_history_type,
      p_history_payload
    );
  END IF;

  IF COALESCE(jsonb_typeof(p_messages), 'null') <> 'array' THEN
    RAISE EXCEPTION 'messages must be an array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.conversations (
    user_id, source_type, source_data, title, messages
  ) VALUES (
    p_user_id,
    p_source_type,
    COALESCE(p_source_data, '{}'::jsonb),
    p_title,
    '[]'::jsonb
  ) RETURNING id INTO v_conversation_id;

  PERFORM public.replace_conversation_messages(v_conversation_id, p_messages);

  IF p_history_type = 'meihua' THEN
    UPDATE public.meihua_divinations
    SET conversation_id = v_conversation_id
    WHERE id::text = p_history_payload->>'divination_id'
      AND user_id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'meihua divination not found';
    END IF;
  ELSE
    UPDATE public.xiaoliuren_divinations
    SET conversation_id = v_conversation_id
    WHERE id::text = p_history_payload->>'divination_id'
      AND user_id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'xiaoliuren divination not found';
    END IF;
  END IF;

  RETURN v_conversation_id::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_analysis_conversation_with_history_legacy_as_service(p_user_id uuid, p_source_type text, p_source_data jsonb, p_title text, p_messages jsonb, p_history_type text, p_history_payload jsonb) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_conversation_id uuid;
  v_yongshen_targets text[];
BEGIN
  IF NOT public.is_admin_user() THEN
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
    messages
  )
  VALUES (
    p_user_id,
    p_source_type,
    COALESCE(p_source_data, '{}'::jsonb),
    p_title,
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

CREATE OR REPLACE FUNCTION public.create_conversation_with_messages(p_user_id uuid, p_title text, p_source_type text DEFAULT NULL::text, p_source_data jsonb DEFAULT NULL::jsonb, p_messages jsonb DEFAULT '[]'::jsonb) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_conversation_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin_user() AND v_actor_id <> p_user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_typeof(p_messages), 'null') <> 'array' THEN
    RAISE EXCEPTION 'messages must be an array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.conversations (
    user_id,
    title,
    source_type,
    source_data,
    messages
  )
  VALUES (
    p_user_id,
    COALESCE(NULLIF(p_title, ''), '新对话'),
    p_source_type,
    p_source_data,
    '[]'::jsonb
  )
  RETURNING id
  INTO v_conversation_id;

  PERFORM public.replace_conversation_messages(v_conversation_id, COALESCE(p_messages, '[]'::jsonb));

  RETURN v_conversation_id::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_knowledge_base_with_limit(p_user_id uuid, p_name text, p_description text DEFAULT NULL::text, p_weight text DEFAULT 'normal'::text, p_limit integer DEFAULT 3) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.delete_agent_retention(p_event_days integer DEFAULT 30, p_commit_days integer DEFAULT 7, p_worker_hours integer DEFAULT 24, p_limit integer DEFAULT 1000, p_metric_days integer DEFAULT 30) RETURNS TABLE(events_deleted bigint, commits_deleted bigint, workers_deleted bigint, metrics_deleted bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_events bigint;
  v_commits bigint;
  v_workers bigint;
  v_metrics bigint;
begin
  if not public.is_admin_user() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_event_days < 7 or p_commit_days < 1 or p_worker_hours < 1 or p_limit < 1 or p_limit > 10000 or p_metric_days < 1 then
    raise exception 'invalid retention bounds' using errcode = '22023';
  end if;

  delete from public.agent_run_events
  where run_id in (
    select id from public.agent_runs
    where status in ('completed', 'failed', 'cancelled')
      and updated_at < now() - make_interval(days => p_event_days)
    limit p_limit
  );
  get diagnostics v_events = row_count;

  delete from public.agent_durable_commits
  where run_id in (
    select id from public.agent_runs
    where status in ('completed', 'failed', 'cancelled')
      and updated_at < now() - make_interval(days => p_commit_days)
    limit p_limit
  );
  get diagnostics v_commits = row_count;

  delete from public.agent_workers
  where id in (
    select id from public.agent_workers
    where heartbeat_at < now() - make_interval(hours => p_worker_hours)
    limit p_limit
  );
  get diagnostics v_workers = row_count;

  delete from public.agent_run_metrics
  where run_id in (
    select run_id from public.agent_run_metrics
    where ended_at < now() - make_interval(days => p_metric_days)
    limit p_limit
  );
  get diagnostics v_metrics = row_count;

  return query select v_events, v_commits, v_workers, v_metrics;
end;
$$;

CREATE OR REPLACE FUNCTION public.delete_conversation_graph(p_conversation_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_conversation_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id
  INTO v_conversation_id
  FROM public.conversations
  WHERE id::text = p_conversation_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF v_conversation_id IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.knowledge_entries e
  USING public.knowledge_bases kb
  WHERE e.kb_id = kb.id AND kb.user_id = v_user_id
    AND e.source_type = 'conversation' AND e.source_id = p_conversation_id;

  DELETE FROM public.archived_sources
  WHERE source_type = 'conversation'
    AND source_id = p_conversation_id
    AND user_id = v_user_id;

  DELETE FROM public.conversations
  WHERE id = v_conversation_id
    AND user_id = v_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_history_item_and_conversation(p_history_type text, p_history_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE
  v_user_id uuid;
  v_table_name text;
  v_conversation_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  CASE p_history_type
    WHEN 'tarot' THEN v_table_name := 'tarot_readings';
    WHEN 'liuyao' THEN v_table_name := 'liuyao_divinations';
    WHEN 'mbti' THEN v_table_name := 'mbti_readings';
    WHEN 'hepan' THEN v_table_name := 'hepan_charts';
    WHEN 'palm' THEN v_table_name := 'palm_readings';
    WHEN 'face' THEN v_table_name := 'face_readings';
    WHEN 'qimen' THEN v_table_name := 'qimen_charts';
    WHEN 'daliuren' THEN v_table_name := 'daliuren_divinations';
    WHEN 'meihua' THEN v_table_name := 'meihua_divinations';
    WHEN 'xiaoliuren' THEN v_table_name := 'xiaoliuren_divinations';
    ELSE RAISE EXCEPTION 'invalid history type' USING ERRCODE = '22023';
  END CASE;

  EXECUTE format(
    'SELECT conversation_id FROM public.%I WHERE id::text = $1 AND user_id = $2 FOR UPDATE',
    v_table_name
  ) INTO v_conversation_id USING p_history_id, v_user_id;

  IF NOT FOUND THEN RETURN false; END IF;

  EXECUTE format(
    'DELETE FROM public.%I WHERE id::text = $1 AND user_id = $2',
    v_table_name
  ) USING p_history_id, v_user_id;

  IF v_conversation_id IS NOT NULL THEN
    PERFORM public.delete_conversation_graph(v_conversation_id::text);
  END IF;
  RETURN true;
END;
$_$;

CREATE OR REPLACE FUNCTION public.fork_conversation_snapshot(p_parent uuid, p_through text, p_source_messages jsonb, p_messages jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE parent public.conversations; target jsonb;
BEGIN
 SELECT * INTO parent FROM public.conversations WHERE id=p_parent AND user_id=auth.uid() FOR UPDATE;
 IF parent.id IS NULL THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF parent.messages IS DISTINCT FROM p_source_messages THEN RAISE EXCEPTION 'BRANCH_CHANGED' USING ERRCODE='40001'; END IF;
 SELECT value INTO target FROM jsonb_array_elements(parent.messages) WHERE value->>'id'=p_through;
 IF target IS NULL OR target->>'role'<>'assistant' OR (target->'agent' IS NOT NULL AND target#>>'{agent,status}'<>'completed') THEN RAISE EXCEPTION 'ANSWER_NOT_COMPLETED' USING ERRCODE='22023'; END IF;
 RETURN public.create_conversation_with_messages(auth.uid(),coalesce(parent.title,'对话')||' · 分叉',NULL,jsonb_build_object('kind','fork','parentConversationId',p_parent,'parentMessageId',p_through),p_messages);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_conversation_share(p_token text) RETURNS TABLE(title text, snapshot jsonb, include_charts boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
 SELECT s.title, s.snapshot, s.include_charts, s.created_at, s.updated_at
   FROM public.conversation_shares s
  WHERE p_token ~ '^[A-Za-z0-9_-]{43}$' AND s.token=p_token AND s.revoked_at IS NULL
  LIMIT 1
$_$;

CREATE OR REPLACE FUNCTION public.get_shared_generated_image(p_token text, p_image uuid) RETURNS TABLE(object_path text, mime_type text, bytes integer, sha256 text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
 SELECT g.object_path, g.mime_type, g.bytes, g.sha256
   FROM public.generated_images g
   JOIN public.conversation_shares s ON s.conversation_id = g.conversation_id
  WHERE p_token ~ '^[A-Za-z0-9_-]{43}$' AND s.token = p_token AND s.revoked_at IS NULL AND g.id = p_image
  LIMIT 1
$_$;

CREATE OR REPLACE FUNCTION public.guard_user_entitlement_writes() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
    v_owner name;
BEGIN
    SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;

    -- Effective SQL identity survives nested SECURITY DEFINER RPCs. Never use
    -- session_user or the JWT role to decide whether this is an owner write.
    IF current_user = v_owner THEN
        RETURN NEW;
    END IF;
    IF current_user = 'authenticated' AND public.is_admin_user() IS TRUE THEN
        RETURN NEW;
    END IF;

    IF current_user <> 'authenticated' OR auth.uid() IS NULL
       OR NEW.id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Account writes require the authenticated owner' USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.is_admin IS DISTINCT FROM false THEN
            RAISE EXCEPTION 'Account entitlement changes require administrator authority' USING ERRCODE = '42501';
        END IF;
    ELSIF ROW(NEW.id, NEW.is_admin) IS DISTINCT FROM ROW(OLD.id, OLD.is_admin) THEN
        RAISE EXCEPTION 'Account entitlement changes require administrator authority' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_ming_records_and_notes(p_records jsonb, p_notes jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_records_imported integer := 0;
  v_notes_imported integer := 0;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_typeof(p_records), 'null') <> 'array' THEN
    RAISE EXCEPTION 'records must be an array' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(jsonb_typeof(p_notes), 'null') <> 'array' THEN
    RAISE EXCEPTION 'notes must be an array' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.ming_records
  WHERE user_id = v_user_id;

  DELETE FROM public.ming_notes
  WHERE user_id = v_user_id;

  INSERT INTO public.ming_records (
    user_id,
    title,
    content,
    category,
    tags,
    event_date,
    related_chart_type,
    related_chart_id,
    is_pinned,
    created_at,
    updated_at
  )
  SELECT
    v_user_id,
    record.title,
    record.content,
    COALESCE(record.category, 'general'),
    CASE
      WHEN record.tags IS NULL THEN '{}'::text[]
      ELSE ARRAY(SELECT jsonb_array_elements_text(record.tags))
    END,
    record.event_date,
    record.related_chart_type,
    record.related_chart_id,
    COALESCE(record.is_pinned, false),
    COALESCE(record.created_at, now()),
    COALESCE(record.updated_at, now())
  FROM jsonb_to_recordset(p_records) AS record(
    title text,
    content text,
    category text,
    tags jsonb,
    event_date date,
    related_chart_type text,
    related_chart_id uuid,
    is_pinned boolean,
    created_at timestamptz,
    updated_at timestamptz
  );

  GET DIAGNOSTICS v_records_imported = ROW_COUNT;

  INSERT INTO public.ming_notes (
    user_id,
    note_date,
    content,
    mood,
    created_at,
    updated_at
  )
  SELECT
    v_user_id,
    COALESCE(note.note_date, CURRENT_DATE),
    note.content,
    note.mood,
    COALESCE(note.created_at, now()),
    COALESCE(note.updated_at, now())
  FROM jsonb_to_recordset(p_notes) AS note(
    note_date date,
    content text,
    mood text,
    created_at timestamptz,
    updated_at timestamptz
  );

  GET DIAGNOSTICS v_notes_imported = ROW_COUNT;

  RETURN jsonb_build_object(
    'recordsImported', v_records_imported,
    'notesImported', v_notes_imported
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_author_profiles(p_user_ids uuid[]) RETURNS TABLE(user_id uuid, nickname text, avatar_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT u.id, u.nickname, u.avatar_url
  FROM public.users u
  WHERE u.id = ANY (p_user_ids)
$$;

CREATE OR REPLACE FUNCTION public.increment_community_post_view_count(post_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.community_posts
  SET view_count = view_count + 1
  WHERE id = post_id
  RETURNING view_count INTO updated_count;

  RETURN updated_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  );
$$;

CREATE OR REPLACE FUNCTION public.kb_replace_source_entries(p_kb_id uuid, p_source_type text, p_source_id text, p_entries jsonb, p_archive boolean DEFAULT false) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor_user_id uuid;
  v_rows integer := 0;
BEGIN
  IF COALESCE(jsonb_typeof(p_entries), 'null') <> 'array' THEN
    RAISE EXCEPTION 'entries must be an array' USING ERRCODE = '22023';
  END IF;

  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NULL THEN
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

CREATE OR REPLACE FUNCTION public.kb_unarchive_source_as_service(p_user_id uuid, p_kb_id uuid, p_source_type text, p_source_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
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

CREATE OR REPLACE FUNCTION public.orphan_agent_attachment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
 UPDATE public.agent_attachments SET orphaned_at=now() WHERE id=OLD.attachment_id AND NOT EXISTS(SELECT 1 FROM public.agent_attachment_refs WHERE attachment_id=OLD.attachment_id);
 RETURN OLD;
END;
$$;

-- A checkout waiting for the payment provider. Plan availability and the
-- per-member limit are checked here; the paid callback no longer refuses.
CREATE OR REPLACE FUNCTION public.payment_order_create(p_user_id uuid, p_trade_no text, p_kind text, p_plan_id uuid, p_credit_micros bigint, p_pay_amount numeric, p_pay_currency text, p_pay_method text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE plan public.subscription_plans; o public.payment_orders;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_kind='subscription' THEN
    PERFORM public.billing_lock_account(p_user_id);
    SELECT * INTO plan FROM public.subscription_plans WHERE id=p_plan_id AND enabled AND purchasable;
    IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_PLAN_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
    IF plan.max_per_user IS NOT NULL
       AND (SELECT count(*) FROM public.user_subscriptions WHERE user_id=p_user_id AND plan_id=plan.id)>=plan.max_per_user THEN
      RAISE EXCEPTION 'BILLING_PLAN_LIMIT' USING ERRCODE='23505';
    END IF;
  END IF;
  INSERT INTO public.payment_orders(trade_no,user_id,kind,plan_id,credit_micros,pay_amount,pay_currency,pay_method)
    VALUES(p_trade_no,p_user_id,p_kind,p_plan_id,p_credit_micros,p_pay_amount,coalesce(p_pay_currency,'CNY'),p_pay_method)
    RETURNING * INTO o;
  RETURN to_jsonb(o);
END;
$$;

-- Settles a paid order once. The callback must name an order of this provider
-- and its exact amount; a repeated callback for a paid order changes nothing.
-- An order expired by maintenance is still honoured: the money was taken.
CREATE OR REPLACE FUNCTION public.payment_order_complete(p_trade_no text, p_provider text, p_paid_amount numeric, p_provider_trade_no text, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE o public.payment_orders; plan public.subscription_plans; sub public.user_subscriptions; wallet bigint;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.payment_orders WHERE trade_no=p_trade_no FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF o.provider IS DISTINCT FROM p_provider THEN RAISE EXCEPTION 'PAYMENT_PROVIDER_MISMATCH' USING ERRCODE='22023'; END IF;
  IF o.status='paid' THEN RETURN jsonb_build_object('status','already_paid','order',to_jsonb(o)); END IF;
  IF o.status NOT IN ('pending','expired') THEN RAISE EXCEPTION 'PAYMENT_ORDER_STATUS_INVALID' USING ERRCODE='22023'; END IF;
  IF p_paid_amount IS DISTINCT FROM o.pay_amount THEN RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH' USING ERRCODE='22023'; END IF;
  wallet := public.billing_lock_account(o.user_id);
  IF o.kind='topup' THEN
    wallet := wallet+o.credit_micros;
    UPDATE public.billing_accounts SET balance_micros=wallet,updated_at=now() WHERE user_id=o.user_id;
    INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_micros,wallet_after_micros,source,reference_type,reference_id,idempotency_key,description)
      VALUES(o.user_id,'topup',o.credit_micros,o.credit_micros,wallet,o.provider,'payment_order',o.id::text,'payment:'||o.trade_no,
        format('在线充值 %s %s',o.pay_amount,o.pay_currency));
  ELSE
    SELECT * INTO STRICT plan FROM public.subscription_plans WHERE id=o.plan_id;
    sub := public.billing_open_subscription(o.user_id,plan,'epay',o.id,NULL);
    INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_after_micros,source,reference_type,reference_id,idempotency_key,description)
      VALUES(o.user_id,'subscription',0,wallet,o.provider,'payment_order',o.id::text,'payment:'||o.trade_no,
        format('在线购买「%s」 %s %s',plan.title,o.pay_amount,o.pay_currency));
  END IF;
  UPDATE public.payment_orders SET status='paid',paid_at=now(),provider_trade_no=p_provider_trade_no,
    provider_payload=p_payload,updated_at=now() WHERE id=o.id RETURNING * INTO o;
  RETURN jsonb_build_object('status','paid','order',to_jsonb(o));
END;
$$;

CREATE OR REPLACE FUNCTION public.process_scheduled_reminder_delivery_as_service(p_reminder_id uuid, p_stale_before timestamp with time zone, p_notification_title text, p_notification_content text, p_notification_link text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.protect_fork_history() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE original jsonb; replacement jsonb;
BEGIN
 FOR original IN SELECT value FROM jsonb_array_elements(coalesce(OLD.messages,'[]')) WHERE value#>>'{metadata,forkHistory}'='true' LOOP
  SELECT value INTO replacement FROM jsonb_array_elements(coalesce(NEW.messages,'[]')) WHERE value->>'id'=original->>'id';
  IF replacement IS DISTINCT FROM original THEN RAISE EXCEPTION 'FORK_HISTORY_READ_ONLY' USING ERRCODE='22023'; END IF;
 END LOOP;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_conversation_messages(p_conversation_id uuid, p_messages jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_typeof(p_messages), 'null') <> 'array' THEN
    RAISE EXCEPTION 'messages must be an array' USING ERRCODE = '22023';
  END IF;

  SELECT user_id
  INTO v_owner
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF auth.uid() <> v_owner AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversations
  SET messages = COALESCE(p_messages, '[]'::jsonb),
      updated_at = now()
  WHERE id = p_conversation_id;

  DELETE FROM public.conversation_messages
  WHERE conversation_id = p_conversation_id;

  INSERT INTO public.conversation_messages (
    conversation_id,
    sequence,
    message_id,
    role,
    content,
    metadata,
    created_at
  )
  SELECT
    p_conversation_id,
    elements.ordinality::integer - 1,
    COALESCE(elements.value->>'id', gen_random_uuid()::text),
    COALESCE(elements.value->>'role', 'assistant'),
    COALESCE(elements.value->>'content', ''),
    (elements.value - 'id' - 'role' - 'content' - 'createdAt'),
    COALESCE(NULLIF(elements.value->>'createdAt', '')::timestamptz, now())
  FROM jsonb_array_elements(COALESCE(p_messages, '[]'::jsonb)) WITH ORDINALITY AS elements(value, ordinality);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_conversation_share(p_conversation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id=p_conversation AND user_id=auth.uid()) THEN
  RAISE EXCEPTION 'CONVERSATION_NOT_FOUND' USING ERRCODE='42501';
 END IF;
 UPDATE public.conversation_shares SET revoked_at=now(), updated_at=now(), snapshot='[]'::jsonb, title=''
  WHERE conversation_id=p_conversation AND user_id=auth.uid() AND revoked_at IS NULL;
 RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_bazi_case_profile_as_service(p_user_id uuid, p_chart_id uuid, p_master_review jsonb, p_owner_feedback jsonb, p_events jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_profile_id uuid;
  v_previous jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_typeof(p_events), 'null') <> 'array' THEN
    RAISE EXCEPTION 'events must be an array' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT lower(event_row.id)
    FROM jsonb_to_recordset(p_events) AS event_row(id text)
    WHERE event_row.id IS NOT NULL
    GROUP BY lower(event_row.id)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate event ids' USING ERRCODE = '22023';
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
    source_run_id = CASE WHEN public.bazi_case_profiles.master_review = EXCLUDED.master_review THEN public.bazi_case_profiles.source_run_id END,
    updated_at = now()
  RETURNING id
  INTO v_profile_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'created_at', created_at, 'source_run_id', source_run_id,
    'event_date', event_date, 'category', category, 'title', title, 'detail', detail
  )), '[]'::jsonb)
  INTO v_previous
  FROM public.bazi_case_events
  WHERE profile_id = v_profile_id
    AND user_id = p_user_id;

  DELETE FROM public.bazi_case_events
  WHERE profile_id = v_profile_id
    AND user_id = p_user_id;

  INSERT INTO public.bazi_case_events (
    id,
    profile_id,
    user_id,
    bazi_chart_id,
    event_date,
    category,
    title,
    detail,
    source_run_id,
    created_at
  )
  SELECT
    COALESCE(kept.id, gen_random_uuid()),
    v_profile_id,
    p_user_id,
    p_chart_id,
    event_row.event_date,
    event_row.category,
    event_row.title,
    NULLIF(event_row.detail, ''),
    CASE
      WHEN kept.event_date = event_row.event_date AND kept.category = event_row.category AND kept.title = event_row.title
        AND kept.detail IS NOT DISTINCT FROM NULLIF(event_row.detail, '') THEN kept.source_run_id
    END,
    COALESCE(kept.created_at, now())
  FROM jsonb_to_recordset(p_events) AS event_row(
    id text,
    event_date date,
    category text,
    title text,
    detail text
  )
  LEFT JOIN jsonb_to_recordset(v_previous) AS kept(
    id uuid, created_at timestamptz, source_run_id uuid, event_date date, category text, title text, detail text
  ) ON kept.id::text = lower(event_row.id);

  RETURN jsonb_build_object(
    'status', 'ok',
    'profile_id', v_profile_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_reminder_if_absent_as_service(p_user_id uuid, p_reminder_type text, p_scheduled_for timestamp with time zone, p_content jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.search_conversation_messages(p_query text, p_limit integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    SET statement_timeout TO '3s'
    AS $$
DECLARE pattern text; result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF length(trim(p_query)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid search query'; END IF;
  pattern := '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  SELECT coalesce(jsonb_agg(to_jsonb(search_rows)), '[]'::jsonb) INTO result FROM (
    (SELECT c.id AS "conversationId", c.title, NULL::text AS "messageId", c.title AS preview, c.updated_at AS "updatedAt",
      (EXISTS (SELECT 1 FROM public.agent_runs r WHERE r.conversation_id=c.id AND r.user_id=c.user_id)) AS "hasAgentRun"
      FROM public.conversations c WHERE c.user_id=auth.uid() AND c.title ILIKE pattern ESCAPE '\' ORDER BY c.updated_at DESC LIMIT 10)
    UNION ALL
    (SELECT c.id, c.title, m.message_id, substr(m.content, greatest(1, strpos(lower(m.content),lower(trim(p_query)))-80), 300), c.updated_at,
      (EXISTS (SELECT 1 FROM public.agent_runs r WHERE r.conversation_id=c.id AND r.user_id=c.user_id)) AS "hasAgentRun"
      FROM public.conversation_messages m JOIN public.conversations c ON c.id=m.conversation_id
      WHERE c.user_id=auth.uid() AND m.role <> 'system' AND m.content ILIKE pattern ESCAPE '\'
      ORDER BY c.updated_at DESC,m.sequence LIMIT least(greatest(p_limit,1),30))
  ) search_rows;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_knowledge_fts(p_query text, p_kb_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 20, p_config text DEFAULT 'simple'::text) RETURNS TABLE(id uuid, kb_id uuid, content text, metadata jsonb, rank real)
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
    v_user_id UUID;
    v_safe_config regconfig;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_safe_config := CASE
        WHEN p_config = 'english' THEN 'pg_catalog.english'::regconfig
        ELSE 'pg_catalog.simple'::regconfig
    END;

    RETURN QUERY
    SELECT e.id, e.kb_id, e.content, e.metadata,
        ts_rank(to_tsvector(v_safe_config, e.content), plainto_tsquery(v_safe_config, p_query))
    FROM public.knowledge_entries e
    JOIN public.knowledge_bases kb ON e.kb_id = kb.id
    WHERE kb.user_id = v_user_id
      AND (p_kb_ids IS NULL OR e.kb_id = ANY(p_kb_ids))
      AND to_tsvector(v_safe_config, e.content) @@ plainto_tsquery(v_safe_config, p_query)
    ORDER BY 5 DESC
    LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_knowledge_trigram(p_query text, p_kb_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 20, p_threshold real DEFAULT 0.3) RETURNS TABLE(id uuid, kb_id uuid, content text, metadata jsonb, similarity real)
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    RETURN QUERY
    SELECT e.id, e.kb_id, e.content, e.metadata, similarity(e.content, p_query)
    FROM public.knowledge_entries e
    JOIN public.knowledge_bases kb ON e.kb_id = kb.id
    WHERE kb.user_id = v_user_id
      AND (p_kb_ids IS NULL OR e.kb_id = ANY(p_kb_ids))
      AND similarity(e.content, p_query) > p_threshold
    ORDER BY 5 DESC
    LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_knowledge_vector(p_query_vector double precision[], p_kb_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 20, p_dim integer DEFAULT 1536) RETURNS TABLE(id uuid, kb_id uuid, content text, metadata jsonb, distance real)
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $_$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if array_length(p_query_vector, 1) != p_dim then
    raise exception 'Query vector dimension (%) does not match p_dim (%)',
      array_length(p_query_vector, 1), p_dim;
  end if;

  return query execute format('
    select e.id, e.kb_id, e.content, e.metadata,
      (e.content_vector::extensions.vector(%s) <=> $1::extensions.vector(%s))::real as distance
    from public.knowledge_entries e
    join public.knowledge_bases kb on e.kb_id = kb.id
    where kb.user_id = $2
      and ($3 is null or e.kb_id = any($3))
      and e.embedding_dim = $4
    order by e.content_vector::extensions.vector(%s) <=> $1::extensions.vector(%s)
    limit $5', p_dim, p_dim, p_dim, p_dim)
  using p_query_vector::extensions.vector, v_user_id, p_kb_ids, p_dim, p_limit;
end;
$_$;

CREATE OR REPLACE FUNCTION public.submit_community_report_and_notify(p_target_type text, p_target_id uuid, p_reason text, p_description text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

  IF p_reason NOT IN ('spam', 'abuse', 'inappropriate', 'other') THEN
    RAISE EXCEPTION 'invalid reason' USING ERRCODE = '22023';
  END IF;

  IF length(coalesce(p_description, '')) > 500 THEN
    RAISE EXCEPTION 'description too long' USING ERRCODE = '22023';
  END IF;

  IF p_target_type = 'post' THEN
    IF NOT EXISTS (SELECT 1 FROM public.community_posts WHERE id = p_target_id AND NOT is_deleted) THEN
      RAISE EXCEPTION 'target not found' USING ERRCODE = 'P0002';
    END IF;
  ELSIF p_target_type = 'comment' THEN
    IF NOT EXISTS (SELECT 1 FROM public.community_comments WHERE id = p_target_id AND NOT is_deleted) THEN
      RAISE EXCEPTION 'target not found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid target_type' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':' || p_target_type || ':' || p_target_id::text,
    0
  ));

  IF EXISTS (
    SELECT 1 FROM public.community_reports
    WHERE reporter_id = v_user_id AND target_type = p_target_type AND target_id = p_target_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'already reported' USING ERRCODE = '23505';
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

CREATE OR REPLACE FUNCTION public.sync_agent_attachment_refs() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE owner_id uuid; document jsonb; ids uuid[]; a public.agent_attachments;
BEGIN
 IF TG_TABLE_NAME='conversations' THEN owner_id:=NEW.user_id; document:=coalesce(NEW.messages,'[]');
 ELSE SELECT user_id INTO owner_id FROM public.agent_runs WHERE id=NEW.run_id; document:=NEW.message; END IF;
 SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO ids FROM jsonb_path_query(document,'lax $.**.attachments.ids[*]') valueset(element),LATERAL (SELECT element#>>'{}' AS value) extracted
 WHERE value ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
 FOR a IN SELECT * FROM public.agent_attachments WHERE id=ANY(ids) OR id IN (
   SELECT attachment_id FROM public.agent_attachment_refs WHERE
    (TG_TABLE_NAME='conversations' AND conversation_id=(to_jsonb(NEW)->>'id')::uuid) OR
    (TG_TABLE_NAME='agent_run_commands' AND command_sequence=(to_jsonb(NEW)->>'sequence')::bigint)
 ) ORDER BY id FOR UPDATE LOOP
   IF a.id=ANY(ids) AND (a.user_id IS DISTINCT FROM owner_id OR a.status<>'ready') THEN RAISE EXCEPTION 'ATTACHMENT_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.agent_attachments WHERE id=ANY(ids) AND user_id=owner_id AND status='ready')<>cardinality(ids) THEN RAISE EXCEPTION 'ATTACHMENT_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='conversations' THEN
   DELETE FROM public.agent_attachment_refs WHERE conversation_id=NEW.id AND NOT attachment_id=ANY(ids);
   INSERT INTO public.agent_attachment_refs(attachment_id,conversation_id) SELECT unnest(ids),NEW.id ON CONFLICT DO NOTHING;
 ELSE
   DELETE FROM public.agent_attachment_refs WHERE command_sequence=NEW.sequence AND (NOT attachment_id=ANY(ids) OR NEW.delivery_state IN ('cancelled','consumed'));
   IF NEW.delivery_state NOT IN ('cancelled','consumed') THEN INSERT INTO public.agent_attachment_refs(attachment_id,command_sequence) SELECT unnest(ids),NEW.sequence ON CONFLICT DO NOTHING; END IF;
 END IF;
 UPDATE public.agent_attachments SET orphaned_at=NULL WHERE id=ANY(ids) AND EXISTS(SELECT 1 FROM public.agent_attachment_refs WHERE attachment_id=id);
 RETURN NEW;
END;
$_$;

CREATE OR REPLACE FUNCTION public.toggle_community_vote(p_target_type text, p_target_id uuid, p_vote_type text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

  IF p_target_type = 'post' THEN
    IF NOT EXISTS (SELECT 1 FROM public.community_posts WHERE id = p_target_id AND NOT is_deleted) THEN
      RAISE EXCEPTION 'target not found' USING ERRCODE = 'P0002';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.community_comments WHERE id = p_target_id AND NOT is_deleted) THEN
    RAISE EXCEPTION 'target not found' USING ERRCODE = 'P0002';
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

CREATE OR REPLACE FUNCTION public.toggle_ming_record_pin(p_record_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.update_ai_model_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_conversation_with_messages(p_conversation_id uuid, p_title text DEFAULT NULL::text, p_title_present boolean DEFAULT false, p_messages jsonb DEFAULT NULL::jsonb, p_messages_present boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT user_id
  INTO v_owner
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF NOT public.is_admin_user() AND v_actor_id <> v_owner THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_messages_present AND COALESCE(jsonb_typeof(p_messages), 'null') <> 'array' THEN
    RAISE EXCEPTION 'messages must be an array' USING ERRCODE = '22023';
  END IF;

  UPDATE public.conversations
  SET
    title = CASE WHEN p_title_present THEN p_title ELSE title END,
    updated_at = now()
  WHERE id = p_conversation_id;

  IF p_messages_present THEN
    PERFORM public.replace_conversation_messages(p_conversation_id, COALESCE(p_messages, '[]'::jsonb));
  END IF;

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.update_conversations_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.upsert_conversation_share(p_conversation uuid, p_token text, p_title text, p_snapshot jsonb, p_include_charts boolean, p_source_updated_at timestamp with time zone) RETURNS public.conversation_shares
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE source public.conversations; share public.conversation_shares;
BEGIN
 SELECT * INTO source FROM public.conversations WHERE id=p_conversation AND user_id=auth.uid() FOR UPDATE;
 IF source.id IS NULL THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF EXISTS (SELECT 1 FROM public.agent_runs WHERE conversation_id=p_conversation AND status IN ('queued','running','awaiting_input','cancelling')) THEN
  RAISE EXCEPTION 'CONVERSATION_BUSY' USING ERRCODE='55006';
 END IF;
 IF source.updated_at IS DISTINCT FROM p_source_updated_at THEN RAISE EXCEPTION 'SHARE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'array' OR octet_length(p_snapshot::text)>1048576 THEN
  RAISE EXCEPTION 'SHARE_SNAPSHOT_INVALID' USING ERRCODE='22023';
 END IF;
 UPDATE public.conversation_shares
    SET title=left(coalesce(p_title,''),200), snapshot=p_snapshot, include_charts=coalesce(p_include_charts,false), updated_at=now()
  WHERE conversation_id=p_conversation AND revoked_at IS NULL
  RETURNING * INTO share;
 IF share.id IS NULL THEN
  INSERT INTO public.conversation_shares (token,user_id,conversation_id,title,snapshot,include_charts)
  VALUES (p_token,auth.uid(),p_conversation,left(coalesce(p_title,''),200),p_snapshot,coalesce(p_include_charts,false))
  RETURNING * INTO share;
 END IF;
 RETURN share;
END;
$$;

CREATE OR REPLACE VIEW public.conversations_with_archive_status WITH (security_invoker='on') AS
 SELECT id,
    user_id,
    title,
    messages,
    created_at,
    updated_at,
    source_type,
    source_data,
    (EXISTS ( SELECT 1
           FROM public.archived_sources a
          WHERE ((a.source_type = 'conversation'::text) AND (a.source_id = (c.id)::text) AND (a.user_id = c.user_id)))) AS is_archived,
    ( SELECT array_agg(a.kb_id) AS array_agg
           FROM public.archived_sources a
          WHERE ((a.source_type = 'conversation'::text) AND (a.source_id = (c.id)::text) AND (a.user_id = c.user_id))) AS archived_kb_ids,
    (EXISTS ( SELECT 1
           FROM public.agent_runs r
          WHERE ((r.conversation_id = c.id) AND (r.user_id = c.user_id)))) AS has_agent_run,
    (EXISTS ( SELECT 1
           FROM public.agent_schedules s
          WHERE ((s.conversation_id = c.id) AND (s.user_id = c.user_id)))) AS is_scheduled
   FROM public.conversations c;

CREATE OR REPLACE VIEW public.ming_records_with_archive_status WITH (security_invoker='on') AS
 SELECT id,
    user_id,
    title,
    content,
    category,
    tags,
    event_date,
    related_chart_type,
    related_chart_id,
    is_pinned,
    created_at,
    updated_at,
    source_run_id,
    (EXISTS ( SELECT 1
           FROM public.archived_sources a
          WHERE ((a.source_type = 'record'::text) AND (a.source_id = (r.id)::text)))) AS is_archived,
    ( SELECT array_agg(a.kb_id) AS array_agg
           FROM public.archived_sources a
          WHERE ((a.source_type = 'record'::text) AND (a.source_id = (r.id)::text))) AS archived_kb_ids,
    ( SELECT s.conversation_id
           FROM public.agent_runs s
          WHERE (s.id = r.source_run_id)) AS source_conversation_id
   FROM public.ming_records r;
