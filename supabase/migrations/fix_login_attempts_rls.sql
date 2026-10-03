-- 修复注册错误：确保 auth 触发器正确工作
-- "Database error saving new user" 通常是由于触发器或RLS策略问题

-- ============================================
-- 1. 检查并修复 user_credits 触发器
-- ============================================

-- 删除旧触发器
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 重新创建更健壮的触发器函数
CREATE OR REPLACE FUNCTION create_user_credits()
RETURNS TRIGGER AS $$
BEGIN
    -- 使用 exception handling 确保不会阻止用户创建
    BEGIN
        INSERT INTO public.user_credits (user_id, credits)
        VALUES (NEW.id, 10)
        ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
        -- 记录错误但不阻止用户创建
        RAISE WARNING 'Failed to create user_credits for user %: %', NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 重新创建触发器
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_user_credits();

-- ============================================
-- 2. 确保 users 表存在并有正确的结构
-- ============================================

-- 创建 users 表（如果不存在）
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nickname TEXT DEFAULT '命理爱好者',
    avatar_url TEXT,
    membership TEXT DEFAULT 'free',
    ai_chat_count INTEGER DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用 RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 删除旧策略
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Service role full access" ON public.users;

-- 用户可以查看自己的信息
CREATE POLICY "Users can view own profile"
ON public.users FOR SELECT
USING (auth.uid() = id);

-- 用户可以创建自己的信息
CREATE POLICY "Users can insert own profile"
ON public.users FOR INSERT
WITH CHECK (auth.uid() = id);

-- 用户可以更新自己的信息
CREATE POLICY "Users can update own profile"
ON public.users FOR UPDATE
USING (auth.uid() = id);

-- 创建用户记录的触发器（从 auth.users 同步）
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    BEGIN
        INSERT INTO public.users (id, nickname, avatar_url, membership, ai_chat_count)
        VALUES (
            NEW.id,
            COALESCE(NEW.raw_user_meta_data->>'nickname', '命理爱好者'),
            NEW.raw_user_meta_data->>'avatar_url',
            'free',
            3
        )
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to create user profile for user %: %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 删除旧触发器
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;

-- 创建新触发器
CREATE TRIGGER on_auth_user_created_profile
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();

-- ============================================
-- 3. login_attempts 的安全函数
-- ============================================

-- 安全记录登录尝试
CREATE OR REPLACE FUNCTION record_login_attempt(
    p_email TEXT,
    p_success BOOLEAN
)
RETURNS void AS $$
BEGIN
    INSERT INTO login_attempts (email, success, attempt_at)
    VALUES (p_email, p_success, NOW());
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to record login attempt: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 安全检查登录尝试次数
CREATE OR REPLACE FUNCTION check_login_attempts(p_email TEXT)
RETURNS TABLE(failed_count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT COUNT(*)::BIGINT
    FROM login_attempts
    WHERE email = p_email
    AND success = false
    AND attempt_at > NOW() - INTERVAL '15 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
