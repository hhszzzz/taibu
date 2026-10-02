-- 为 tarot_readings 表添加 RLS 策略
-- 运行此脚本前，请先在 Supabase 控制台启用 tarot_readings 表的 RLS

-- 启用 RLS
ALTER TABLE tarot_readings ENABLE ROW LEVEL SECURITY;

-- 允许用户读取自己的记录
CREATE POLICY "Users can view own tarot readings"
ON tarot_readings FOR SELECT
USING (auth.uid() = user_id);

-- 允许用户插入自己的记录（服务端使用 service role key 会绕过此策略）
CREATE POLICY "Users can insert own tarot readings"
ON tarot_readings FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- 允许用户删除自己的记录
CREATE POLICY "Users can delete own tarot readings"
ON tarot_readings FOR DELETE
USING (auth.uid() = user_id);

-- 注意：服务端 API 使用 service role key (SUPABASE_SERVICE_ROLE_KEY)
-- 会自动绕过 RLS，因此插入操作不受影响
