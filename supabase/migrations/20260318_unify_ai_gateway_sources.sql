-- 统一 AI 网关配置重建设计
-- 目标：
-- 1. 清空旧 ai_models 数据，交由管理员重新在线配置
-- 2. 移除旧 ai_model_sources / ai_model_stats 结构
-- 3. 引入全局 ai_gateways 与 ai_model_gateway_bindings

DROP FUNCTION IF EXISTS public.record_ai_model_call(text, text, boolean, integer, integer);
DROP TABLE IF EXISTS public.ai_model_stats;
DROP TABLE IF EXISTS public.ai_model_sources;

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS usage_type text,
  ADD COLUMN IF NOT EXISTS routing_mode text,
  ADD COLUMN IF NOT EXISTS default_top_p numeric(3,2),
  ADD COLUMN IF NOT EXISTS default_presence_penalty numeric(4,2),
  ADD COLUMN IF NOT EXISTS default_frequency_penalty numeric(4,2),
  ADD COLUMN IF NOT EXISTS default_reasoning_effort text,
  ADD COLUMN IF NOT EXISTS reasoning_effort_format text,
  ADD COLUMN IF NOT EXISTS custom_parameters jsonb;

UPDATE public.ai_models
SET usage_type = CASE
  WHEN supports_vision = true THEN 'vision'
  ELSE 'chat'
END
WHERE usage_type IS NULL;

UPDATE public.ai_models
SET routing_mode = 'auto'
WHERE routing_mode IS NULL;

UPDATE public.ai_models
SET default_top_p = 1
WHERE default_top_p IS NULL;

UPDATE public.ai_models
SET default_presence_penalty = 0
WHERE default_presence_penalty IS NULL;

UPDATE public.ai_models
SET default_frequency_penalty = 0
WHERE default_frequency_penalty IS NULL;

ALTER TABLE public.ai_models
  ALTER COLUMN usage_type SET DEFAULT 'chat',
  ALTER COLUMN usage_type SET NOT NULL,
  ALTER COLUMN routing_mode SET DEFAULT 'auto',
  ALTER COLUMN routing_mode SET NOT NULL,
  ALTER COLUMN default_top_p SET DEFAULT 1,
  ALTER COLUMN default_presence_penalty SET DEFAULT 0,
  ALTER COLUMN default_frequency_penalty SET DEFAULT 0;

ALTER TABLE public.ai_models
  DROP CONSTRAINT IF EXISTS ai_models_usage_type_check;

ALTER TABLE public.ai_models
  ADD CONSTRAINT ai_models_usage_type_check
  CHECK (usage_type IN ('chat', 'vision', 'embedding', 'rerank'));

ALTER TABLE public.ai_models
  DROP CONSTRAINT IF EXISTS ai_models_routing_mode_check;

ALTER TABLE public.ai_models
  ADD CONSTRAINT ai_models_routing_mode_check
  CHECK (routing_mode IN ('auto', 'newapi', 'octopus'));

ALTER TABLE public.ai_models
  DROP CONSTRAINT IF EXISTS ai_models_default_reasoning_effort_check;

ALTER TABLE public.ai_models
  ADD CONSTRAINT ai_models_default_reasoning_effort_check
  CHECK (default_reasoning_effort IS NULL OR default_reasoning_effort IN ('minimal', 'low', 'medium', 'high'));

ALTER TABLE public.ai_models
  DROP CONSTRAINT IF EXISTS ai_models_reasoning_effort_format_check;

ALTER TABLE public.ai_models
  ADD CONSTRAINT ai_models_reasoning_effort_format_check
  CHECK (reasoning_effort_format IS NULL OR reasoning_effort_format IN ('reasoning_object', 'reasoning_effort'));

DELETE FROM public.ai_models;

CREATE TABLE IF NOT EXISTS public.ai_gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  base_url text NOT NULL DEFAULT '',
  api_key_env_var text NOT NULL,
  transport text NOT NULL DEFAULT 'openai_compatible',
  is_enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_gateways_gateway_key_check
    CHECK (gateway_key IN ('newapi', 'octopus')),
  CONSTRAINT ai_gateways_transport_check
    CHECK (transport IN ('openai_compatible'))
);

CREATE TABLE IF NOT EXISTS public.ai_model_gateway_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.ai_models(id) ON DELETE CASCADE,
  gateway_id uuid NOT NULL REFERENCES public.ai_gateways(id) ON DELETE CASCADE,
  model_id_override text,
  reasoning_model_id text,
  is_enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_model_gateway_bindings_unique UNIQUE (model_id, gateway_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_gateways_enabled
  ON public.ai_gateways(is_enabled);

CREATE INDEX IF NOT EXISTS idx_ai_model_gateway_bindings_model_id
  ON public.ai_model_gateway_bindings(model_id);

CREATE INDEX IF NOT EXISTS idx_ai_model_gateway_bindings_gateway_id
  ON public.ai_model_gateway_bindings(gateway_id);

CREATE INDEX IF NOT EXISTS idx_ai_model_gateway_bindings_priority
  ON public.ai_model_gateway_bindings(model_id, priority);

ALTER TABLE public.ai_gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_model_gateway_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_gateways_admin_all" ON public.ai_gateways;
CREATE POLICY "ai_gateways_admin_all" ON public.ai_gateways
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "ai_model_gateway_bindings_admin_all" ON public.ai_model_gateway_bindings;
CREATE POLICY "ai_model_gateway_bindings_admin_all" ON public.ai_model_gateway_bindings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE OR REPLACE FUNCTION public.update_ai_model_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS ai_gateways_updated_at ON public.ai_gateways;
CREATE TRIGGER ai_gateways_updated_at
  BEFORE UPDATE ON public.ai_gateways
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

DROP TRIGGER IF EXISTS ai_model_gateway_bindings_updated_at ON public.ai_model_gateway_bindings;
CREATE TRIGGER ai_model_gateway_bindings_updated_at
  BEFORE UPDATE ON public.ai_model_gateway_bindings
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

INSERT INTO public.ai_gateways (
  gateway_key,
  display_name,
  base_url,
  api_key_env_var,
  transport,
  is_enabled,
  notes
)
VALUES
  ('newapi', 'NewAPI', '', 'NEWAPI_API_KEY', 'openai_compatible', true, 'Primary managed gateway'),
  ('octopus', 'Octopus', '', 'OCTOPUS_API_KEY', 'openai_compatible', true, 'Backup managed gateway')
ON CONFLICT (gateway_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  api_key_env_var = EXCLUDED.api_key_env_var,
  transport = EXCLUDED.transport,
  is_enabled = EXCLUDED.is_enabled,
  notes = EXCLUDED.notes;
