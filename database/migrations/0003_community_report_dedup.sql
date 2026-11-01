-- Preserve one pending report per user and target before the unique index is reconciled.
DO $$
DECLARE
  core_columns integer;
  review_columns integer;
BEGIN
  IF to_regclass('public.community_reports') IS NOT NULL THEN
    SELECT count(*) INTO core_columns
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'community_reports'
      AND column_name IN ('id', 'reporter_id', 'target_type', 'target_id', 'status', 'created_at');

    IF core_columns = 6 THEN
      SELECT count(*) INTO review_columns
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'community_reports'
        AND column_name IN ('reviewed_at', 'review_notes');

      IF review_columns = 2 THEN
        WITH ranked AS (
          SELECT id, row_number() OVER (
            PARTITION BY reporter_id, target_type, target_id
            ORDER BY created_at, id
          ) AS position
          FROM public.community_reports
          WHERE status = 'pending'
        )
        UPDATE public.community_reports AS report
        SET status = 'dismissed',
            reviewed_at = COALESCE(report.reviewed_at, now()),
            review_notes = left(concat_ws(E'\n', NULLIF(btrim(report.review_notes), ''), '升级时合并重复待处理举报；保留最早记录。'), 500)
        FROM ranked
        WHERE ranked.id = report.id AND ranked.position > 1;
      ELSE
        WITH ranked AS (
          SELECT id, row_number() OVER (
            PARTITION BY reporter_id, target_type, target_id
            ORDER BY created_at, id
          ) AS position
          FROM public.community_reports
          WHERE status = 'pending'
        )
        UPDATE public.community_reports AS report
        SET status = 'dismissed'
        FROM ranked
        WHERE ranked.id = report.id AND ranked.position > 1;
      END IF;
    END IF;
  END IF;
END
$$;
