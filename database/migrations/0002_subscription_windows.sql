-- Move the legacy one-window subscription allowance into the current limit tables.
-- db:init applies migrations before reconciling current schema, so create these
-- destination tables here for databases that still have the old subscription shape.
CREATE TABLE IF NOT EXISTS public.subscription_plan_limits (
  plan_id uuid NOT NULL,
  period text NOT NULL,
  allowance_micros bigint NOT NULL,
  CONSTRAINT subscription_plan_limits_allowance_micros_check CHECK (allowance_micros > 0),
  CONSTRAINT subscription_plan_limits_period_check CHECK (period = ANY (ARRAY['five_hour'::text, 'daily'::text, 'weekly'::text, 'monthly'::text, 'total'::text])),
  CONSTRAINT subscription_plan_limits_pkey PRIMARY KEY (plan_id, period)
);

CREATE TABLE IF NOT EXISTS public.user_subscription_limits (
  subscription_id uuid NOT NULL,
  period text NOT NULL,
  allowance_micros bigint NOT NULL,
  used_micros bigint DEFAULT 0 NOT NULL,
  next_reset_at timestamp with time zone,
  CONSTRAINT user_subscription_limits_allowance_micros_check CHECK (allowance_micros > 0),
  CONSTRAINT user_subscription_limits_period_check CHECK ((period = ANY (ARRAY['five_hour'::text, 'daily'::text, 'weekly'::text, 'monthly'::text, 'total'::text]))),
  CONSTRAINT user_subscription_limits_used_micros_check CHECK ((used_micros >= 0) AND (used_micros <= allowance_micros)),
  CONSTRAINT user_subscription_limits_pkey PRIMARY KEY (subscription_id, period)
);

DO $$
DECLARE
  plan_columns integer;
  subscription_columns integer;
BEGIN
  IF to_regclass('public.subscription_plans') IS NOT NULL THEN
    SELECT count(*) INTO plan_columns
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscription_plans'
      AND column_name IN ('allowance_micros', 'reset_period');

    IF plan_columns = 1 THEN
      RAISE EXCEPTION 'subscription_plans has only part of its legacy allowance columns';
    ELSIF plan_columns = 2 THEN
      INSERT INTO public.subscription_plan_limits (plan_id, period, allowance_micros)
      SELECT id,
        CASE reset_period
          WHEN 'never' THEN 'total'
          WHEN 'daily' THEN 'daily'
          WHEN 'weekly' THEN 'weekly'
          WHEN 'monthly' THEN 'monthly'
          ELSE NULL
        END,
        allowance_micros
      FROM public.subscription_plans
      ON CONFLICT (plan_id, period) DO UPDATE
        SET allowance_micros = EXCLUDED.allowance_micros;
    END IF;

    EXECUTE 'ALTER TABLE public.subscription_plans DROP COLUMN IF EXISTS allowance_micros, DROP COLUMN IF EXISTS reset_period';
  END IF;

  IF to_regclass('public.user_subscriptions') IS NOT NULL THEN
    SELECT count(*) INTO subscription_columns
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_subscriptions'
      AND column_name IN ('allowance_micros', 'reset_period', 'used_micros', 'next_reset_at');

    IF subscription_columns BETWEEN 1 AND 3 THEN
      RAISE EXCEPTION 'user_subscriptions has only part of its legacy allowance columns';
    ELSIF subscription_columns = 4 THEN
      INSERT INTO public.user_subscription_limits (
        subscription_id, period, allowance_micros, used_micros, next_reset_at
      )
      SELECT id,
        CASE reset_period
          WHEN 'never' THEN 'total'
          WHEN 'daily' THEN 'daily'
          WHEN 'weekly' THEN 'weekly'
          WHEN 'monthly' THEN 'monthly'
          ELSE NULL
        END,
        allowance_micros,
        used_micros,
        CASE WHEN reset_period = 'never' THEN NULL ELSE next_reset_at END
      FROM public.user_subscriptions
      ON CONFLICT (subscription_id, period) DO UPDATE
        SET allowance_micros = EXCLUDED.allowance_micros,
            used_micros = EXCLUDED.used_micros,
            next_reset_at = EXCLUDED.next_reset_at;
    END IF;

    EXECUTE 'ALTER TABLE public.user_subscriptions DROP COLUMN IF EXISTS allowance_micros, DROP COLUMN IF EXISTS reset_period, DROP COLUMN IF EXISTS used_micros, DROP COLUMN IF EXISTS next_reset_at';
  END IF;
END
$$;
