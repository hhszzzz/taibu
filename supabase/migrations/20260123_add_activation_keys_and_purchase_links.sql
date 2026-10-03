-- Migration: Add activation keys table and purchase links table
-- Created: 2026-01-23

-- 激活Key表
CREATE TABLE IF NOT EXISTS public.activation_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_code TEXT UNIQUE NOT NULL,           -- 格式: sk-xxxx
    key_type TEXT NOT NULL CHECK (key_type IN ('membership', 'credits')),
    membership_type TEXT CHECK (
        (key_type = 'membership' AND membership_type IN ('plus', 'pro'))
        OR (key_type = 'credits' AND membership_type IS NULL)
    ),
    credits_amount INTEGER CHECK (
        (key_type = 'credits' AND credits_amount > 0)
        OR (key_type = 'membership' AND credits_amount IS NULL)
    ),
    is_used BOOLEAN DEFAULT FALSE,
    used_by UUID REFERENCES auth.users(id),
    used_at TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 购买链接表 (按订阅类型分别配置)
CREATE TABLE IF NOT EXISTS public.purchase_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_type TEXT UNIQUE NOT NULL CHECK (link_type IN ('plus', 'pro', 'credits')),
    url TEXT NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for activation_keys
ALTER TABLE public.activation_keys ENABLE ROW LEVEL SECURITY;

-- 管理员可以查看所有激活Key
CREATE POLICY "Admins can view all keys"
    ON public.activation_keys FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    );

-- 管理员可以创建激活Key
CREATE POLICY "Admins can create keys"
    ON public.activation_keys FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    );

-- 管理员可以更新激活Key (标记为已使用等)
CREATE POLICY "Admins can update keys"
    ON public.activation_keys FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    );

-- 管理员可以删除激活Key
CREATE POLICY "Admins can delete keys"
    ON public.activation_keys FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    );

-- 普通用户需要通过API激活Key,由服务端处理

-- RLS for purchase_links
ALTER TABLE public.purchase_links ENABLE ROW LEVEL SECURITY;

-- 所有已登录用户可以查看购买链接
CREATE POLICY "Authenticated users can view purchase links"
    ON public.purchase_links FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- 管理员可以管理购买链接
CREATE POLICY "Admins can manage purchase links"
    ON public.purchase_links FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    );

-- 添加索引优化查询
CREATE INDEX IF NOT EXISTS idx_activation_keys_code ON public.activation_keys(key_code);
CREATE INDEX IF NOT EXISTS idx_activation_keys_unused ON public.activation_keys(is_used) WHERE is_used = FALSE;
CREATE INDEX IF NOT EXISTS idx_activation_keys_type ON public.activation_keys(key_type);
CREATE INDEX IF NOT EXISTS idx_purchase_links_type ON public.purchase_links(link_type);
