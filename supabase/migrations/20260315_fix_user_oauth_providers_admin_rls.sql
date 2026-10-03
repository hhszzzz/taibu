-- Allow system-admin session clients to manage Linux.do oauth provider bindings.

DROP POLICY IF EXISTS "Service role full access on oauth providers"
ON public.user_oauth_providers;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_oauth_providers'
      AND policyname = 'Admins full access'
  ) THEN
    CREATE POLICY "Admins full access" ON public.user_oauth_providers
      FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;
END $$;
