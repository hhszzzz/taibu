CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    weight TEXT CHECK (weight IN ('low', 'normal', 'high')) DEFAULT 'normal',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.archived_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('conversation', 'record')),
    source_id UUID NOT NULL,
    kb_id UUID NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (source_type, source_id, kb_id)
);

CREATE TABLE public.knowledge_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id UUID NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_vector vector,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    chunk_index INT NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT knowledge_entries_source_unique
        UNIQUE (kb_id, source_type, source_id, chunk_index),
    CONSTRAINT vector_metadata_check CHECK (
        content_vector IS NULL OR (
            metadata ? 'embedding_model' AND
            metadata ? 'embedding_dim'
        )
    )
);

CREATE INDEX knowledge_entries_fts_idx
    ON public.knowledge_entries
    USING GIN (to_tsvector('simple', content));

CREATE INDEX knowledge_entries_trgm_idx
    ON public.knowledge_entries
    USING GIN (content gin_trgm_ops);

CREATE INDEX archived_sources_user_idx ON public.archived_sources(user_id);
CREATE INDEX archived_sources_source_idx ON public.archived_sources(source_type, source_id);
CREATE INDEX archived_sources_kb_idx ON public.archived_sources(kb_id);

ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archived_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户只能访问自己的知识库" ON public.knowledge_bases
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "用户只能访问自己的归档来源" ON public.archived_sources
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "用户只能访问自己的知识条目" ON public.knowledge_entries
    FOR ALL USING (
        kb_id IN (SELECT id FROM public.knowledge_bases WHERE user_id = auth.uid())
    );
