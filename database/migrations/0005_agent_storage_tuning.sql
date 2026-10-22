-- Compress the two large JSONB columns written on every checkpoint and let
-- autovacuum keep up with the high update rate on Agent run rows.
alter table public.agent_runs
  alter column checkpoint set compression lz4,
  alter column public_message set compression lz4;

alter table public.agent_runs
  set (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.agent_workers
  set (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
