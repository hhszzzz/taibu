-- Converge legacy schema (pre-ed14ffd9) to current structure.
-- Every reference is guarded, so the file runs against any intermediate state.

-- Delete obsolete tables (CASCADE removes dependent views, policies, triggers)
DROP TABLE IF EXISTS public.activation_keys CASCADE;
DROP TABLE IF EXISTS public.credit_transactions CASCADE;
DROP TABLE IF EXISTS public.daily_checkins CASCADE;
DROP TABLE IF EXISTS public.daily_briefing_jobs CASCADE;

-- Delete obsolete columns
ALTER TABLE IF EXISTS public.users DROP COLUMN IF EXISTS membership;
ALTER TABLE IF EXISTS public.users DROP COLUMN IF EXISTS membership_expires_at;
ALTER TABLE IF EXISTS public.users DROP COLUMN IF EXISTS ai_chat_count;

ALTER TABLE IF EXISTS public.agent_mcp_servers DROP COLUMN IF EXISTS required_tier;
ALTER TABLE IF EXISTS public.agent_profiles DROP COLUMN IF EXISTS required_tier;
ALTER TABLE IF EXISTS public.agent_skills DROP COLUMN IF EXISTS required_tier;

ALTER TABLE IF EXISTS public.ai_models DROP COLUMN IF EXISTS required_tier;
ALTER TABLE IF EXISTS public.ai_models DROP COLUMN IF EXISTS credit_cost;
ALTER TABLE IF EXISTS public.ai_models DROP COLUMN IF EXISTS supports_reasoning;
ALTER TABLE IF EXISTS public.ai_models DROP COLUMN IF EXISTS reasoning_required_tier;
ALTER TABLE IF EXISTS public.ai_models DROP COLUMN IF EXISTS default_temperature;
ALTER TABLE IF EXISTS public.ai_models DROP COLUMN IF EXISTS routing_mode;
ALTER TABLE IF EXISTS public.ai_models DROP COLUMN IF EXISTS default_top_p;
ALTER TABLE IF EXISTS public.ai_models DROP COLUMN IF EXISTS default_presence_penalty;
ALTER TABLE IF EXISTS public.ai_models DROP COLUMN IF EXISTS default_frequency_penalty;
ALTER TABLE IF EXISTS public.ai_models DROP COLUMN IF EXISTS reasoning_effort_format;

ALTER TABLE IF EXISTS public.ai_gateways DROP COLUMN IF EXISTS api_key_env_var;
ALTER TABLE IF EXISTS public.ai_gateways DROP COLUMN IF EXISTS transport;
ALTER TABLE IF EXISTS public.ai_gateways DROP COLUMN IF EXISTS notes;

ALTER TABLE IF EXISTS public.ai_model_gateway_bindings DROP COLUMN IF EXISTS reasoning_model_id;
ALTER TABLE IF EXISTS public.ai_model_gateway_bindings DROP COLUMN IF EXISTS notes;

ALTER TABLE IF EXISTS public.user_settings DROP COLUMN IF EXISTS daily_briefing_settings;

-- app_settings.setting_value: boolean -> jsonb, keeping the stored values.
-- The boolean default does not cast to jsonb, so it is replaced around the type change.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_settings' AND column_name = 'setting_value'
      AND data_type = 'boolean'
  ) THEN
    ALTER TABLE public.app_settings
      ALTER COLUMN setting_value DROP DEFAULT,
      ALTER COLUMN setting_value TYPE jsonb USING to_jsonb(setting_value),
      ALTER COLUMN setting_value SET DEFAULT 'false'::jsonb;
  END IF;
END $$;

-- agent_runs.billing: renamed states. The old CHECK only allows the old
-- values, so it is dropped first; db:init adds the declared one back.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_runs' AND column_name = 'billing'
  ) THEN
    ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_billing_check;
    UPDATE public.agent_runs SET billing = 'metered' WHERE billing = 'charged';
    UPDATE public.agent_runs SET billing = 'exempt' WHERE billing = 'refunded';
  END IF;
END $$;

-- ai_models.usage_type 'vision' became a chat model flag
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_models' AND column_name = 'usage_type'
  ) THEN
    ALTER TABLE public.ai_models DROP CONSTRAINT IF EXISTS ai_models_usage_type_check;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_models' AND column_name = 'supports_vision'
    ) THEN
      UPDATE public.ai_models SET usage_type = 'chat', supports_vision = true WHERE usage_type = 'vision';
    ELSE
      UPDATE public.ai_models SET usage_type = 'chat' WHERE usage_type = 'vision';
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_models' AND column_name = 'description'
    ) THEN
      UPDATE public.ai_models SET description = substring(description, 1, 200) WHERE char_length(description) > 200;
    END IF;
  END IF;
END $$;

-- Daily briefing reminders were retired
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reminder_subscriptions' AND column_name = 'reminder_type'
  ) THEN
    DELETE FROM public.reminder_subscriptions WHERE reminder_type = 'daily_briefing';
  END IF;
END $$;
