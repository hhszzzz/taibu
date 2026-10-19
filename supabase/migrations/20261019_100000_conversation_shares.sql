-- Public read-only conversation shares.
-- A share is an owner-created, sanitised snapshot of a conversation's visible branch.
-- Owners read their own rows through RLS; every write goes through the owner RPCs below,
-- and anonymous visitors can only resolve a single active snapshot by its unguessable token.
CREATE TABLE public.conversation_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{43}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(snapshot) = 'array'),
  include_charts boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX conversation_shares_active_conversation_idx ON public.conversation_shares (conversation_id) WHERE revoked_at IS NULL;
CREATE INDEX conversation_shares_user_created_idx ON public.conversation_shares (user_id, created_at DESC);

ALTER TABLE public.conversation_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_shares_owner_select ON public.conversation_shares FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON TABLE public.conversation_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversation_shares TO authenticated;

-- Create or refresh the conversation's single active share. Refreshing keeps the existing token,
-- so links already handed out stay valid. Rejects foreign conversations, running Agent tasks and
-- snapshots built from an outdated conversation state.
CREATE FUNCTION public.upsert_conversation_share(p_conversation uuid,p_token text,p_title text,p_snapshot jsonb,p_include_charts boolean,p_source_updated_at timestamptz) RETURNS public.conversation_shares
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source public.conversations; share public.conversation_shares;
BEGIN
 SELECT * INTO source FROM public.conversations WHERE id=p_conversation AND user_id=auth.uid() FOR UPDATE;
 IF source.id IS NULL THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF EXISTS (SELECT 1 FROM public.agent_runs WHERE conversation_id=p_conversation AND status IN ('queued','running','awaiting_input','cancelling')) THEN
  RAISE EXCEPTION 'CONVERSATION_BUSY' USING ERRCODE='55006';
 END IF;
 IF source.updated_at IS DISTINCT FROM p_source_updated_at THEN RAISE EXCEPTION 'SHARE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'array' OR octet_length(p_snapshot::text)>1048576 THEN
  RAISE EXCEPTION 'SHARE_SNAPSHOT_INVALID' USING ERRCODE='22023';
 END IF;
 UPDATE public.conversation_shares
    SET title=left(coalesce(p_title,''),200), snapshot=p_snapshot, include_charts=coalesce(p_include_charts,false), updated_at=now()
  WHERE conversation_id=p_conversation AND revoked_at IS NULL
  RETURNING * INTO share;
 IF share.id IS NULL THEN
  INSERT INTO public.conversation_shares (token,user_id,conversation_id,title,snapshot,include_charts)
  VALUES (p_token,auth.uid(),p_conversation,left(coalesce(p_title,''),200),p_snapshot,coalesce(p_include_charts,false))
  RETURNING * INTO share;
 END IF;
 RETURN share;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_conversation_share(uuid,text,text,jsonb,boolean,timestamptz) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.upsert_conversation_share(uuid,text,text,jsonb,boolean,timestamptz) TO authenticated;

-- Revoke the active share and purge its content; the row only remains as an owner audit trail.
CREATE FUNCTION public.revoke_conversation_share(p_conversation uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id=p_conversation AND user_id=auth.uid()) THEN
  RAISE EXCEPTION 'CONVERSATION_NOT_FOUND' USING ERRCODE='42501';
 END IF;
 UPDATE public.conversation_shares SET revoked_at=now(), updated_at=now(), snapshot='[]'::jsonb, title=''
  WHERE conversation_id=p_conversation AND user_id=auth.uid() AND revoked_at IS NULL;
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_conversation_share(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.revoke_conversation_share(uuid) TO authenticated;

-- Anonymous lookup of one active share. Exposes only presentation fields, never owner or conversation ids.
CREATE FUNCTION public.get_conversation_share(p_token text) RETURNS TABLE (title text, snapshot jsonb, include_charts boolean, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT s.title, s.snapshot, s.include_charts, s.created_at, s.updated_at
   FROM public.conversation_shares s
  WHERE p_token ~ '^[A-Za-z0-9_-]{43}$' AND s.token=p_token AND s.revoked_at IS NULL
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_conversation_share(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_conversation_share(text) TO anon, authenticated;
