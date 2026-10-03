-- MCP unban semantics patch
-- 目标：
-- 1) 解除封禁后立即恢复为可用状态（避免新增“停用”业务状态）
-- 2) 回填历史“未封禁但停用”的记录为活跃状态

-- 历史回填：未封禁记录统一恢复活跃
UPDATE public.mcp_api_keys
SET is_active = true
WHERE is_banned = false
  AND is_active = false;

-- 管理员解封：恢复活跃状态
CREATE OR REPLACE FUNCTION public.admin_unban_mcp_key(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    affected integer := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid() AND u.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Only admin can unban mcp key' USING ERRCODE = '42501';
    END IF;

    -- 受控内部更新：仅在当前事务生效
    PERFORM set_config('mingai.mcp_internal_update', '1', true);

    UPDATE public.mcp_api_keys
    SET is_banned = false,
        is_active = true
    WHERE user_id = p_user_id
      AND is_banned = true;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unban_mcp_key(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_unban_mcp_key(uuid) TO authenticated;
