-- Mirror every identity row into the public profile table, and seed the
-- credential-less system principal used by systemDb().

CREATE OR REPLACE FUNCTION identity.handle_user_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.users (id, nickname, avatar_url, membership, ai_chat_count)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.name), ''), '命理爱好者'),
    NEW.image,
    'free',
    1
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION identity.handle_user_created() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_identity_user_created ON identity.users;
CREATE TRIGGER on_identity_user_created
AFTER INSERT ON identity.users
FOR EACH ROW EXECUTE FUNCTION identity.handle_user_created();

INSERT INTO identity.users (id, email, email_verified, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'system@taibu.invalid', true, '系统')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, nickname, membership, ai_chat_count, is_admin)
VALUES ('00000000-0000-4000-8000-000000000001', '系统', 'pro', 999999, true)
ON CONFLICT (id) DO UPDATE SET is_admin = true;
