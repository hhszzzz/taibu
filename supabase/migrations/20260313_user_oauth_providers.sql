-- OAuth 第三方登录身份关联表
CREATE TABLE public.user_oauth_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  provider_email text,
  provider_username text,
  provider_avatar_url text,
  provider_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT uq_provider_identity UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_oauth_providers_user ON public.user_oauth_providers(user_id);
CREATE INDEX idx_oauth_providers_lookup ON public.user_oauth_providers(provider, provider_user_id);

-- RLS
ALTER TABLE public.user_oauth_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own oauth providers"
  ON public.user_oauth_providers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on oauth providers"
  ON public.user_oauth_providers FOR ALL
  USING (auth.role() = 'service_role');
