CREATE TABLE IF NOT EXISTS public.app_settings (
    setting_key text PRIMARY KEY,
    setting_value boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_settings (setting_key, setting_value)
VALUES ('payments_paused', false)
ON CONFLICT (setting_key) DO NOTHING;
