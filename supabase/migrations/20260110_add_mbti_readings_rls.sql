-- MBTI 分析记录表 + RLS 策略

CREATE TABLE IF NOT EXISTS public.mbti_readings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mbti_type text NOT NULL,
  scores jsonb,
  percentages jsonb,
  analysis text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT mbti_readings_pkey PRIMARY KEY (id),
  CONSTRAINT mbti_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

ALTER TABLE public.mbti_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own mbti readings" ON public.mbti_readings;
DROP POLICY IF EXISTS "Users can insert own mbti readings" ON public.mbti_readings;
DROP POLICY IF EXISTS "Users can delete own mbti readings" ON public.mbti_readings;

CREATE POLICY "Users can view own mbti readings"
ON public.mbti_readings FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mbti readings"
ON public.mbti_readings FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own mbti readings"
ON public.mbti_readings FOR DELETE
USING (auth.uid() = user_id);
