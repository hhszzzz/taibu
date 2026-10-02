BEGIN;

ALTER TABLE public.community_posts
DROP COLUMN IF EXISTS anonymous_name;

COMMIT;
