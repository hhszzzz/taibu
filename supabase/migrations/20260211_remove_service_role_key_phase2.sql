-- Phase 2: remove service role key dependency
-- 方案：
-- 1) 使用系统管理员会话（authenticated + is_admin）代替 service role
-- 2) 为已启用 RLS 的 public 表补齐统一管理员全权限策略
-- 3) 提供管理员读取 auth.users 邮箱的受控 RPC

-- 管理员判定函数（避免在 policy 中重复编写 exists 子查询）
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_user() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;

-- 管理员邮箱查询 RPC（替代 auth.admin.getUserById）
CREATE OR REPLACE FUNCTION public.admin_get_auth_user_emails(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Only admin can read auth user emails' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT au.id, au.email::text
  FROM auth.users au
  WHERE au.id = ANY (p_user_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_auth_user_emails(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_auth_user_emails(uuid[]) TO authenticated;

-- 为所有已启用 RLS 的 public 表补齐管理员全权限策略
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = table_name
        AND p.policyname = 'Admins full access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "Admins full access" ON public.%I FOR ALL USING (public.is_admin_user()) WITH CHECK (public.is_admin_user())',
        table_name
      );
    END IF;
  END LOOP;
END $$;
