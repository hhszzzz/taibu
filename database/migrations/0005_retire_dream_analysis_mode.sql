-- 解梦不再是普通对话的分析风格：旧会话归为普通对话，旧人格归为通用，来源类型不再接受 dream。
-- Existing rows must be rewritten before the CHECK is tightened, and the migration must not fail on a
-- database that never had the old constraint.

DO $$
BEGIN
  IF to_regclass('public.conversations') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.conversations SET source_type = 'chat' WHERE source_type = 'dream';
  UPDATE public.conversations SET personality = 'general' WHERE personality IN ('dream', 'mangpai');

  ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_source_type_check;
  ALTER TABLE public.conversations ADD CONSTRAINT conversations_source_type_check
    CHECK (source_type = ANY (ARRAY[
      'chat'::text, 'bazi_wuxing'::text, 'bazi_personality'::text, 'tarot'::text, 'liuyao'::text,
      'mbti'::text, 'hepan'::text, 'palm'::text, 'face'::text, 'qimen'::text, 'daliuren'::text,
      'meihua'::text, 'xiaoliuren'::text, 'ziwei'::text
    ]));
END $$;
