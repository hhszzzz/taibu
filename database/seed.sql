-- Required system principal; preserve existing application data.
INSERT INTO identity.users (id, email, email_verified, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'system@taibu.invalid', true, '系统')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, nickname, membership, ai_chat_count, is_admin)
VALUES ('00000000-0000-4000-8000-000000000001', '系统', 'pro', 999999, true)
ON CONFLICT (id) DO UPDATE SET is_admin = true;
