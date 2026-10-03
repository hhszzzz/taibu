-- User settings table for notification preferences
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    notifications_enabled BOOLEAN DEFAULT TRUE,
    notify_email BOOLEAN DEFAULT TRUE,
    notify_site BOOLEAN DEFAULT TRUE,
    language TEXT DEFAULT 'zh',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;

CREATE POLICY "Users can view own settings"
    ON public.user_settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
    ON public.user_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
    ON public.user_settings FOR UPDATE
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_settings_user ON public.user_settings(user_id);

-- Only server-side code should insert notifications (service role bypasses RLS)
DROP POLICY IF EXISTS "系统可以创建通知" ON public.notifications;

-- Allow users to update their feature subscriptions (required for upsert)
DROP POLICY IF EXISTS "用户可以更新自己的订阅" ON public.feature_subscriptions;
CREATE POLICY "用户可以更新自己的订阅"
    ON public.feature_subscriptions FOR UPDATE
    USING (auth.uid() = user_id);
