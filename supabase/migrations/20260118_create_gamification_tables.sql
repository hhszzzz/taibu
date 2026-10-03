-- Phase 7: 游戏化与激励系统
-- 包含用户等级、签到、积分交易、成就等功能

-- 用户等级与经验
CREATE TABLE IF NOT EXISTS user_levels (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    level int DEFAULT 1,
    experience int DEFAULT 0,
    total_experience int DEFAULT 0,
    title text DEFAULT '初学者',
    updated_at timestamp with time zone DEFAULT now()
);

-- 签到记录
CREATE TABLE IF NOT EXISTS daily_checkins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    checkin_date date NOT NULL,
    streak_days int DEFAULT 1,
    reward_credits int DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE(user_id, checkin_date)
);

-- 积分交易记录
CREATE TABLE IF NOT EXISTS credit_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount int NOT NULL,
    type text NOT NULL CHECK (type IN ('earn', 'spend', 'reward')),
    source text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now()
);

-- 成就系统
CREATE TABLE IF NOT EXISTS user_achievements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    achievement_key text NOT NULL,
    unlocked_at timestamp with time zone DEFAULT now(),
    UNIQUE(user_id, achievement_key)
);

-- 提醒订阅配置
CREATE TABLE IF NOT EXISTS reminder_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reminder_type text NOT NULL CHECK (reminder_type IN ('solar_term', 'fortune', 'key_date')),
    enabled boolean DEFAULT true,
    notify_email boolean DEFAULT false,
    notify_site boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE(user_id, reminder_type)
);

-- 计划任务记录
CREATE TABLE IF NOT EXISTS scheduled_reminders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reminder_type text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    content jsonb,
    sent boolean DEFAULT false,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

-- 年度报告缓存
CREATE TABLE IF NOT EXISTS annual_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    year int NOT NULL,
    report_data jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now(),
    UNIQUE(user_id, year)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_daily_checkins_user_date ON daily_checkins(user_id, checkin_date);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_pending ON scheduled_reminders(scheduled_for) WHERE sent = false;
CREATE INDEX IF NOT EXISTS idx_annual_reports_user_year ON annual_reports(user_id, year);

-- RLS 策略
ALTER TABLE user_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE annual_reports ENABLE ROW LEVEL SECURITY;

-- user_levels 策略
CREATE POLICY "Users can view own level" ON user_levels FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own level" ON user_levels FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own level" ON user_levels FOR INSERT WITH CHECK (auth.uid() = user_id);

-- daily_checkins 策略
CREATE POLICY "Users can view own checkins" ON daily_checkins FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own checkins" ON daily_checkins FOR INSERT WITH CHECK (auth.uid() = user_id);

-- credit_transactions 策略
CREATE POLICY "Users can view own transactions" ON credit_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own transactions" ON credit_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- user_achievements 策略
CREATE POLICY "Users can view own achievements" ON user_achievements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own achievements" ON user_achievements FOR INSERT WITH CHECK (auth.uid() = user_id);

-- reminder_subscriptions 策略
CREATE POLICY "Users can view own subscriptions" ON reminder_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own subscriptions" ON reminder_subscriptions FOR ALL USING (auth.uid() = user_id);

-- scheduled_reminders 策略
CREATE POLICY "Users can view own reminders" ON scheduled_reminders FOR SELECT USING (auth.uid() = user_id);

-- annual_reports 策略
CREATE POLICY "Users can view own reports" ON annual_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own reports" ON annual_reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reports" ON annual_reports FOR UPDATE USING (auth.uid() = user_id);
