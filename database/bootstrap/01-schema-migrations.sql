-- taibu_meta schema and schema_migrations table
-- Used for tracking applied migrations. Not part of RELATION_SCHEMAS (not compared during reconcile).
-- Idempotent; run after 00-roles.sql.

CREATE TABLE IF NOT EXISTS taibu_meta.schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT now(),
  duration_ms INTEGER,
  baseline BOOLEAN DEFAULT FALSE
);

ALTER TABLE taibu_meta.schema_migrations OWNER TO taibu_owner;
