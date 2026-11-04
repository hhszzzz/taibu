-- 人格层取消后 conversations.personality 不再参与提示词，也不再写入：删除该列，
-- 并丢弃接收 p_personality 的旧函数重载（reconcile 会按 database/functions.sql 重建新签名）。

DO $$
BEGIN
  IF to_regclass('public.conversations') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.conversations DROP COLUMN IF EXISTS personality;

  DROP FUNCTION IF EXISTS public.create_analysis_conversation_with_history_as_service(uuid, text, jsonb, text, text, jsonb, text, jsonb);
  DROP FUNCTION IF EXISTS public.create_analysis_conversation_with_history_legacy_as_service(uuid, text, jsonb, text, text, jsonb, text, jsonb);
  DROP FUNCTION IF EXISTS public.create_conversation_with_messages(uuid, text, text, text, jsonb, jsonb);
  DROP FUNCTION IF EXISTS public.update_conversation_with_messages(uuid, text, boolean, text, boolean, jsonb, boolean);
END $$;
