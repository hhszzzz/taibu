-- 会话类别补全：分叉会话复制了 Agent 消息（message.agent），但分叉本身没有
-- agent_runs 记录，导致「对话」列表混入 Agent 记录。类别改为二者取或：
--   1. 该会话存在 agent_runs 记录；或
--   2. 该会话的消息数组里带有 agent 快照（分叉、导入的历史任务）。
-- 只替换视图，列顺序与 security_invoker 与既有定义保持一致。
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
    (
        EXISTS (
            SELECT 1
            FROM public.agent_runs r
            WHERE r.conversation_id = c.id
              AND r.user_id = c.user_id
        )
        OR (
            jsonb_typeof(c.messages) = 'array'
            AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(c.messages) AS message
                WHERE message ? 'agent'
            )
        )
    ) AS has_agent_run
FROM public.conversations c;
ALTER VIEW public.conversations_with_archive_status SET (security_invoker = on);
