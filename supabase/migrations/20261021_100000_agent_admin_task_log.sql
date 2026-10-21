-- The settings center's Agent task panel rebuilds a run's Pi Durable tasks and
-- conversations from its commit log, finished runs included. The log stays
-- closed to client roles and readable through the worker's lease only; this
-- read is for administrators and keeps only what the task tree uses, each
-- write in its own shape: conversations; tasks without their memos;
-- submissions (states and request IDs; they hold no content); of an assistant
-- entry only the id and name of each tool call. Transcript text, tool results,
-- reasoning and document state, queued input included, stay in the database.
-- Read only: no table, column, policy or index change (the primary key
-- (run_id, sequence) serves the ordered page), no backfill.
BEGIN;

CREATE FUNCTION public.agent_admin_task_log(p_run_id uuid,p_after bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
REVOKE ALL ON FUNCTION public.agent_admin_task_log(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.agent_admin_task_log(uuid,bigint) TO authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
