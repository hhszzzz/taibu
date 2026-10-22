-- Identity storage for Better Auth. Application profile data stays in public.users;
-- this schema holds credentials, sessions and OTP material and is never exposed
-- through the public RLS surface.

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog AS $$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '')
$$;

REVOKE ALL ON FUNCTION auth.uid(), auth.role() FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, taibu_app;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role, taibu_app;

CREATE TABLE identity.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  name text NOT NULL DEFAULT '',
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_users_email_key UNIQUE (email),
  CONSTRAINT identity_users_email_lowercase CHECK (email = lower(email))
);

CREATE TABLE identity.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_sessions_token_key UNIQUE (token)
);
CREATE INDEX identity_sessions_user_id_idx ON identity.sessions (user_id);
CREATE INDEX identity_sessions_expires_at_idx ON identity.sessions (expires_at);

CREATE TABLE identity.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_accounts_provider_account_key UNIQUE (provider_id, account_id)
);
CREATE INDEX identity_accounts_user_id_idx ON identity.accounts (user_id);

CREATE TABLE identity.verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_verifications_identifier_idx ON identity.verifications (identifier);
CREATE INDEX identity_verifications_expires_at_idx ON identity.verifications (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO taibu_auth;
