-- MCP guard patch: allow trusted SECURITY DEFINER RPC paths to perform protected updates.
-- 背景：
-- 1) guard trigger 会拦截 authenticated 角色对受保护字段的更新
-- 2) mcp_reset_key / admin_revoke_mcp_key 同样运行在 authenticated 角色下
-- 3) 需要一个“仅限函数内、仅限本事务”的受控绕过标记

CREATE OR REPLACE FUNCTION public.guard_mcp_key_user_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    is_internal_update boolean := current_setting('mingai.mcp_internal_update', true) = '1';
BEGIN
    -- 仅允许受信任函数在事务内显式开启的内部更新绕过保护字段检查
    IF is_internal_update THEN
        RETURN NEW;
    END IF;

    IF auth.role() = 'authenticated' THEN
        -- 仅允许操作自身记录
        IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'Forbidden to update this key';
        END IF;

        -- 被永久封禁后，禁止用户态更新（含重置 key）
        IF OLD.is_banned THEN
            RAISE EXCEPTION 'Current account mcp key is permanently banned';
        END IF;

        -- 用户态禁止修改受保护字段
        IF NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.is_active IS DISTINCT FROM OLD.is_active
           OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
           OR NEW.reset_count IS DISTINCT FROM OLD.reset_count
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Forbidden field update on mcp key';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_reset_key(p_user_id uuid, p_new_key_code text)
RETURNS SETOF public.mcp_api_keys
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- 仅允许用户重置自己的 key
    IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'Forbidden: can only reset own key' USING ERRCODE = '42501';
    END IF;

    -- 受控内部更新：仅在当前事务生效
    PERFORM set_config('mingai.mcp_internal_update', '1', true);

    RETURN QUERY
    UPDATE public.mcp_api_keys
    SET key_code = p_new_key_code,
        reset_count = reset_count + 1,
        is_active = true,
        last_used_at = NULL
    WHERE user_id = p_user_id
      AND is_banned = false
    RETURNING *;
END;
$$;

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
        is_active = false,
        last_used_at = NULL
    WHERE user_id = p_user_id
      AND is_banned = true;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_mcp_key(p_user_id uuid)
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
        RAISE EXCEPTION 'Only admin can revoke mcp key' USING ERRCODE = '42501';
    END IF;

    -- 受控内部更新：仅在当前事务生效
    PERFORM set_config('mingai.mcp_internal_update', '1', true);

    UPDATE public.mcp_api_keys
    SET is_active = false,
        is_banned = true
    WHERE user_id = p_user_id;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_reset_key(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.admin_unban_mcp_key(uuid) FROM public;
REVOKE ALL ON FUNCTION public.admin_revoke_mcp_key(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.mcp_reset_key(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unban_mcp_key(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_mcp_key(uuid) TO authenticated;
