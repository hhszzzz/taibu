CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  message_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_conversation_sequence_idx
  ON public.conversation_messages(conversation_id, sequence);

CREATE INDEX IF NOT EXISTS conversation_messages_conversation_created_idx
  ON public.conversation_messages(conversation_id, created_at DESC);

ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own conversation messages" ON public.conversation_messages;
CREATE POLICY "Users can view own conversation messages"
  ON public.conversation_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations
      WHERE conversations.id = conversation_messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own conversation messages" ON public.conversation_messages;
CREATE POLICY "Users can insert own conversation messages"
  ON public.conversation_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.conversations
      WHERE conversations.id = conversation_messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own conversation messages" ON public.conversation_messages;
CREATE POLICY "Users can update own conversation messages"
  ON public.conversation_messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations
      WHERE conversations.id = conversation_messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.conversations
      WHERE conversations.id = conversation_messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own conversation messages" ON public.conversation_messages;
CREATE POLICY "Users can delete own conversation messages"
  ON public.conversation_messages FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations
      WHERE conversations.id = conversation_messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  );

INSERT INTO public.conversation_messages (
  conversation_id,
  sequence,
  message_id,
  role,
  content,
  metadata,
  created_at
)
SELECT
  conversations.id,
  elements.ordinality::integer - 1,
  COALESCE(elements.value->>'id', gen_random_uuid()::text),
  COALESCE(elements.value->>'role', 'assistant'),
  COALESCE(elements.value->>'content', ''),
  (elements.value - 'id' - 'role' - 'content' - 'createdAt'),
  COALESCE(NULLIF(elements.value->>'createdAt', '')::timestamptz, conversations.created_at)
FROM public.conversations
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(conversations.messages, '[]'::jsonb)) WITH ORDINALITY AS elements(value, ordinality)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.conversation_messages
  WHERE conversation_messages.conversation_id = conversations.id
);

CREATE OR REPLACE FUNCTION public.replace_conversation_messages(
  p_conversation_id uuid,
  p_messages jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id
  INTO v_owner
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> v_owner THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  UPDATE public.conversations
  SET messages = COALESCE(p_messages, '[]'::jsonb),
      updated_at = now()
  WHERE id = p_conversation_id;

  DELETE FROM public.conversation_messages
  WHERE conversation_id = p_conversation_id;

  INSERT INTO public.conversation_messages (
    conversation_id,
    sequence,
    message_id,
    role,
    content,
    metadata,
    created_at
  )
  SELECT
    p_conversation_id,
    elements.ordinality::integer - 1,
    COALESCE(elements.value->>'id', gen_random_uuid()::text),
    COALESCE(elements.value->>'role', 'assistant'),
    COALESCE(elements.value->>'content', ''),
    (elements.value - 'id' - 'role' - 'content' - 'createdAt'),
    COALESCE(NULLIF(elements.value->>'createdAt', '')::timestamptz, now())
  FROM jsonb_array_elements(COALESCE(p_messages, '[]'::jsonb)) WITH ORDINALITY AS elements(value, ordinality);
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_conversation_messages(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_conversation_messages(uuid, jsonb) TO service_role;
