-- Agent 档案：长期记忆开启时，Agent 可检索用户的其他对话，并把用户亲口说的经历直接记入档案；
-- Agent 的判断与结论只生成保存卡片，由用户点「保存」后写入。
-- 沿用现有结构：八字命盘的关键事件进断事笔记（bazi_case_events）；旺衰、格局、五行喜忌只补填命理师判断
-- （bazi_case_profiles.master_review）中尚未填写的项；其余命盘的事件与全部分析结论进命理记录（ming_records）。
-- 三张表各加一列 source_run_id（写入它的 Agent 任务），不新增表。断事笔记整组保存时沿用原事件 ID 与创建时间；
-- 事件或命理师判断被用户改动后，不再算 Agent 写入。
--
-- 新链版本：由 supabase/migrations/20261021_120000_agent_user_archive.sql 移植。相对原文件的差异只有三处：
-- 事务边界交给迁移 runner（去掉首尾 BEGIN/COMMIT）、去掉 PostgREST 的 NOTIFY、按 0012 的口径重建视图授权。

-- The schema snapshot lists the column, so a fresh install creates it with the table; the reference is always added here,
-- after the Agent tables exist.
ALTER TABLE public.ming_records ADD COLUMN IF NOT EXISTS source_run_id uuid;
ALTER TABLE public.bazi_case_events ADD COLUMN IF NOT EXISTS source_run_id uuid;
ALTER TABLE public.bazi_case_profiles ADD COLUMN IF NOT EXISTS source_run_id uuid;
ALTER TABLE public.ming_records ADD CONSTRAINT ming_records_source_run_id_fkey
  FOREIGN KEY (source_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.bazi_case_events ADD CONSTRAINT bazi_case_events_source_run_id_fkey
  FOREIGN KEY (source_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.bazi_case_profiles ADD CONSTRAINT bazi_case_profiles_source_run_id_fkey
  FOREIGN KEY (source_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;
-- Deleting a conversation deletes its runs; these keep the SET NULL scan off the whole table.
CREATE INDEX IF NOT EXISTS ming_records_source_run ON public.ming_records(source_run_id) WHERE source_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bazi_case_events_source_run ON public.bazi_case_events(source_run_id) WHERE source_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bazi_case_profiles_source_run ON public.bazi_case_profiles(source_run_id) WHERE source_run_id IS NOT NULL;
-- read_user_data lists the records linked to the chart it reads.
CREATE INDEX IF NOT EXISTS ming_records_related_chart ON public.ming_records(user_id, related_chart_type, related_chart_id) WHERE related_chart_id IS NOT NULL;

-- The source task is the row owner's own, whichever path writes the column.
CREATE FUNCTION public.agent_archive_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.agent_runs WHERE id=NEW.source_run_id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'AGENT_ARCHIVE_SOURCE_OWNER' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.agent_archive_source_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER agent_archive_source_guard BEFORE INSERT OR UPDATE OF source_run_id,user_id ON public.ming_records
  FOR EACH ROW WHEN (NEW.source_run_id IS NOT NULL) EXECUTE FUNCTION public.agent_archive_source_guard();
CREATE TRIGGER agent_archive_source_guard BEFORE INSERT OR UPDATE OF source_run_id,user_id ON public.bazi_case_events
  FOR EACH ROW WHEN (NEW.source_run_id IS NOT NULL) EXECUTE FUNCTION public.agent_archive_source_guard();
CREATE TRIGGER agent_archive_source_guard BEFORE INSERT OR UPDATE OF source_run_id,user_id ON public.bazi_case_profiles
  FOR EACH ROW WHEN (NEW.source_run_id IS NOT NULL) EXECUTE FUNCTION public.agent_archive_source_guard();

-- A record is edited in place: once the user changes what it says, it is no longer the Agent's. Pinning, tags and the
-- linked chart are not what it says.
CREATE FUNCTION public.agent_archive_record_edited() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.source_run_id IS NOT DISTINCT FROM OLD.source_run_id
    AND (NEW.title,NEW.content,NEW.category,NEW.event_date) IS DISTINCT FROM (OLD.title,OLD.content,OLD.category,OLD.event_date) THEN
    NEW.source_run_id:=NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.agent_archive_record_edited() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER agent_archive_record_edited BEFORE UPDATE OF title,content,category,event_date ON public.ming_records
  FOR EACH ROW WHEN (OLD.source_run_id IS NOT NULL) EXECUTE FUNCTION public.agent_archive_record_edited();

-- The record list reads the view; it now carries the source task (r.*) and that task's conversation. Everything else is
-- 20260125_update_archived_source_views unchanged. A view cannot gain a column in place, so it is recreated.
DROP VIEW IF EXISTS public.ming_records_with_archive_status;
CREATE VIEW public.ming_records_with_archive_status WITH (security_invoker = on) AS
SELECT
    r.*,
    EXISTS (
        SELECT 1 FROM public.archived_sources a
        WHERE a.source_type = 'record'
        AND a.source_id = r.id::text
    ) AS is_archived,
    (
        SELECT array_agg(kb_id)
        FROM public.archived_sources a
        WHERE a.source_type = 'record'
        AND a.source_id = r.id::text
    ) AS archived_kb_ids,
    (SELECT s.conversation_id FROM public.agent_runs s WHERE s.id = r.source_run_id) AS source_conversation_id
FROM public.ming_records r;
REVOKE ALL ON public.ming_records_with_archive_status FROM PUBLIC, anon, authenticated, service_role;
-- Production (0012) also holds SELECT for anon on this view; security_invoker keeps RLS in force.
-- The old view's anon INSERT/UPDATE/DELETE privileges are not restored: a view with subqueries is not updatable.
GRANT SELECT ON public.ming_records_with_archive_status TO anon, authenticated, service_role;

-- The case notes page saves the whole profile. An event that keeps its ID keeps its creation time, and its source task
-- while it is unchanged; a new event never brings its own ID or source. So does the master review.
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

-- What the user said to the Agent in this conversation: each task's message, and the messages delivered to a task.
CREATE FUNCTION public.agent_user_said(p_run public.agent_runs, p_text text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT length(btrim(coalesce(p_text,''))) > 0 AND EXISTS(
    SELECT 1 FROM public.agent_runs ar
    WHERE ar.conversation_id=p_run.conversation_id AND ar.user_id=p_run.user_id
      AND ((ar.input->'userMessage'->>'role'='user' AND strpos(coalesce(ar.input->'userMessage'->>'content',''),p_text)>0)
        OR EXISTS(SELECT 1 FROM public.agent_run_commands c WHERE c.run_id=ar.id AND c.message->>'role'='user'
          AND c.delivery_state IN ('admitted','consumed') AND strpos(coalesce(c.message->>'content',''),p_text)>0)));
$$;

-- One archive entry per tool call: a replayed call or a second click finds the same row.
CREATE FUNCTION public.agent_archive_entry_id(p_run_id uuid,p_call_id text) RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT md5(p_run_id::text||':'||p_call_id)::uuid;
$$;

-- A saved item the owner may link an entry to: one of the data-source types with a table of its own.
CREATE FUNCTION public.agent_archive_chart_owned(p_user_id uuid,p_type text,p_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
$$;

-- An event: on a bazi chart it is a key event of the chart's case notes, otherwise a 人生事件 record.
CREATE FUNCTION public.agent_archive_event(p_run public.agent_runs,p_id uuid,p_chart_type text,p_chart_id uuid,p_event_date date,p_category text,p_title text,p_detail text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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

-- Fill the master review's empty items only: 旺衰, 格局, and 五行喜忌 as one group (all four roles empty), so a filled
-- judgement is never overwritten and the roles never mix two analyses.
CREATE FUNCTION public.agent_fill_master_review(p_run public.agent_runs,p_chart_id uuid,p_review jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
REVOKE ALL ON FUNCTION public.agent_user_said(public.agent_runs,text),public.agent_archive_entry_id(uuid,text),
  public.agent_archive_chart_owned(uuid,text,uuid),public.agent_archive_event(public.agent_runs,uuid,text,uuid,date,text,text,text),
  public.agent_fill_master_review(public.agent_runs,uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- 事实直写: the user's own words about their past, with long-term memory on. The words are the event's detail.
CREATE FUNCTION public.agent_record_user_event(p_run_id uuid,p_worker_id text,p_fence bigint,p_call_id text,p_chart_type text,p_chart_id uuid,
  p_event_date date,p_category text,p_title text,p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
REVOKE ALL ON FUNCTION public.agent_record_user_event(uuid,text,bigint,text,text,uuid,date,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.agent_record_user_event(uuid,text,bigint,text,text,uuid,date,text,text,text) TO authenticated,service_role;

-- 推断确认: the owner saves a proposal the task made. The entry comes from the task's cached tool result, never the browser.
CREATE FUNCTION public.agent_save_archive_proposal(p_run_id uuid,p_call_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
REVOKE ALL ON FUNCTION public.agent_save_archive_proposal(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.agent_save_archive_proposal(uuid,text) TO authenticated;

-- The owner's other conversations, with long-term memory on: messages containing every word of the query, a question
-- with the start of its answer and an answer with its question. Bound to the leased task's owner, like the knowledge
-- search; the longest word goes first so the trigram index of 20261007_120000 can serve it.
CREATE FUNCTION public.agent_search_conversations(p_run_id uuid,p_worker_id text,p_fence bigint,p_query text,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
REVOKE ALL ON FUNCTION public.agent_search_conversations(uuid,text,bigint,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.agent_search_conversations(uuid,text,bigint,text,integer) TO authenticated,service_role;
