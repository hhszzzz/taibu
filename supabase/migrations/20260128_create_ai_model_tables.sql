-- AI 服务管理表
-- 用于管理员配置 AI 模型、来源切换、调用统计

-- ===== 表 1: ai_models - 模型配置 =====
CREATE TABLE IF NOT EXISTS public.ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key text NOT NULL UNIQUE,        -- 内部标识: 'deepseek-v3.2', 'glm-4.7'
  display_name text NOT NULL,            -- 显示名称: 'DeepSeek V3.2'
  vendor text NOT NULL,                  -- 供应商: 'deepseek', 'glm', 'gemini', 'qwen', 'deepai'

  is_enabled boolean DEFAULT true,       -- 是否启用
  sort_order integer DEFAULT 0,          -- 排序顺序

  -- 访问控制
  required_tier text NOT NULL DEFAULT 'free' CHECK (required_tier IN ('free', 'plus', 'pro')),
  supports_reasoning boolean DEFAULT false,
  reasoning_required_tier text DEFAULT 'plus' CHECK (reasoning_required_tier IN ('free', 'plus', 'pro')),
  is_reasoning_default boolean DEFAULT false,
  supports_vision boolean DEFAULT false,

  -- 默认参数
  default_temperature numeric(3,2) DEFAULT 0.7,
  default_max_tokens integer DEFAULT 4000,

  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_ai_models_enabled ON public.ai_models(is_enabled);
CREATE INDEX IF NOT EXISTS idx_ai_models_vendor ON public.ai_models(vendor);

-- ===== 表 2: ai_model_sources - 模型来源 =====
CREATE TABLE IF NOT EXISTS public.ai_model_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.ai_models(id) ON DELETE CASCADE,

  source_key text NOT NULL,              -- 来源标识: 'siliconflow', 'official', 'nvidia'
  source_name text NOT NULL,             -- 来源名称: '硅基流动', '官方API', 'NVIDIA'

  api_url text NOT NULL,                 -- API 端点
  api_key_env_var text NOT NULL,         -- 环境变量名: 'DEEPSEEK_API_KEY'
  model_id_override text,                -- API 调用的模型 ID（覆盖默认）
  reasoning_model_id text,               -- 推理模式的模型 ID

  is_active boolean DEFAULT false,       -- 是否为活跃来源（每个模型只能有一个）
  is_enabled boolean DEFAULT true,       -- 是否启用
  priority integer DEFAULT 0,            -- 优先级（用于回退）

  max_context_tokens integer,            -- 来源特定的上下文长度限制
  max_output_tokens integer,             -- 来源特定的输出长度限制
  notes text,                            -- 备注

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT unique_model_source UNIQUE (model_id, source_key)
);

-- 确保每个模型只有一个活跃来源
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_model_sources_active
  ON public.ai_model_sources(model_id) WHERE is_active = true;

-- 索引
CREATE INDEX IF NOT EXISTS idx_ai_model_sources_model_id ON public.ai_model_sources(model_id);

-- ===== 表 3: ai_model_stats - 调用统计 =====
CREATE TABLE IF NOT EXISTS public.ai_model_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key text NOT NULL,               -- 模型标识
  source_key text,                       -- 来源标识（可选）

  date date NOT NULL DEFAULT CURRENT_DATE,

  call_count integer DEFAULT 0,          -- 调用次数
  success_count integer DEFAULT 0,       -- 成功次数
  error_count integer DEFAULT 0,         -- 错误次数
  total_tokens_used bigint DEFAULT 0,    -- 总 token 使用量
  total_response_time_ms bigint DEFAULT 0, -- 总响应时间（毫秒）

  CONSTRAINT unique_model_stats_per_day UNIQUE (model_key, source_key, date)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_ai_model_stats_date ON public.ai_model_stats(date);
CREATE INDEX IF NOT EXISTS idx_ai_model_stats_model_key ON public.ai_model_stats(model_key);

-- ===== RLS 策略 =====

-- ai_models: 仅管理员可写，所有人可读（用于前端模型选择）
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_models_select_all" ON public.ai_models
  FOR SELECT USING (true);

CREATE POLICY "ai_models_admin_all" ON public.ai_models
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ai_model_sources: 仅管理员可访问
ALTER TABLE public.ai_model_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_model_sources_admin_all" ON public.ai_model_sources
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ai_model_stats: 仅管理员可读，系统可写
ALTER TABLE public.ai_model_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_model_stats_admin_select" ON public.ai_model_stats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ===== 触发器: 自动更新 updated_at =====
CREATE OR REPLACE FUNCTION public.update_ai_model_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_models_updated_at
  BEFORE UPDATE ON public.ai_models
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

CREATE TRIGGER ai_model_sources_updated_at
  BEFORE UPDATE ON public.ai_model_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

-- ===== 函数: 记录 AI 调用统计 =====
CREATE OR REPLACE FUNCTION public.record_ai_model_call(
  p_model_key text,
  p_source_key text DEFAULT NULL,
  p_success boolean DEFAULT true,
  p_tokens_used integer DEFAULT 0,
  p_response_time_ms integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ai_model_stats (model_key, source_key, date, call_count, success_count, error_count, total_tokens_used, total_response_time_ms)
  VALUES (
    p_model_key,
    p_source_key,
    CURRENT_DATE,
    1,
    CASE WHEN p_success THEN 1 ELSE 0 END,
    CASE WHEN p_success THEN 0 ELSE 1 END,
    COALESCE(p_tokens_used, 0),
    COALESCE(p_response_time_ms, 0)
  )
  ON CONFLICT (model_key, source_key, date) DO UPDATE SET
    call_count = ai_model_stats.call_count + 1,
    success_count = ai_model_stats.success_count + CASE WHEN p_success THEN 1 ELSE 0 END,
    error_count = ai_model_stats.error_count + CASE WHEN p_success THEN 0 ELSE 1 END,
    total_tokens_used = ai_model_stats.total_tokens_used + COALESCE(p_tokens_used, 0),
    total_response_time_ms = ai_model_stats.total_response_time_ms + COALESCE(p_response_time_ms, 0);
END;
$$;

-- 授权：允许所有认证用户调用统计函数
GRANT EXECUTE ON FUNCTION public.record_ai_model_call TO authenticated;
