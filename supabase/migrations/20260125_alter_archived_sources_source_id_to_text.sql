ALTER TABLE public.archived_sources
    ALTER COLUMN source_id TYPE TEXT
    USING source_id::text;
