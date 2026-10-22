-- migrate:no-transaction
-- Foreign keys used by list, cleanup and cascade paths.
create index concurrently if not exists agent_attachments_user_idx
  on public.agent_attachments (user_id);
create index concurrently if not exists agent_attachment_refs_conversation_idx
  on public.agent_attachment_refs (conversation_id);
create index concurrently if not exists agent_runs_record_idx
  on public.agent_runs (record_id) where record_id is not null;
create index concurrently if not exists community_comments_post_idx
  on public.community_comments (post_id);
create index concurrently if not exists community_reports_reporter_idx
  on public.community_reports (reporter_id);
create index concurrently if not exists bazi_case_events_chart_idx
  on public.bazi_case_events (bazi_chart_id);
create index concurrently if not exists user_agent_memory_source_run_idx
  on public.user_agent_memory (source_run_id) where source_run_id is not null;
