-- 「对话 / Agent 记录」分离：会话列表按类别过滤。
-- 类别 = 该会话是否跑过 Agent 任务（agent_runs 中存在对应记录）：
--   has_agent_run = true  → Agent 任务会话
--   has_agent_run = false → 普通对话会话
-- 依据：agent_runs(user_id, conversation_id, created_at) 已有索引 agent_conversation_runs，
-- 本视图的 EXISTS 同时带 user_id 与 conversation_id，可命中该索引；
-- RLS 由 security_invoker = on 沿用既有策略（与 archived_sources 的 EXISTS 同一模式）。
CREATE OR REPLACE VIEW public.conversations_with_archive_status AS
SELECT
    c.id,
    c.user_id,
    c.personality,
    c.title,
    c.messages,
    c.created_at,
    c.updated_at,
    c.source_type,
    c.source_data,
    EXISTS (
        SELECT 1
        FROM public.archived_sources a
        WHERE a.source_type = 'conversation'
          AND a.source_id = c.id::text
          AND a.user_id = c.user_id
    ) AS is_archived,
    (
        SELECT array_agg(a.kb_id)
        FROM public.archived_sources a
        WHERE a.source_type = 'conversation'
          AND a.source_id = c.id::text
          AND a.user_id = c.user_id
    ) AS archived_kb_ids,
    EXISTS (
        SELECT 1
        FROM public.agent_runs r
        WHERE r.conversation_id = c.id
          AND r.user_id = c.user_id
    ) AS has_agent_run
FROM public.conversations c;
ALTER VIEW public.conversations_with_archive_status SET (security_invoker = on);
