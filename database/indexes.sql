-- Current definitions. Safe to apply repeatedly; no migration history.
-- Maintained directly as PostgreSQL SQL.

CREATE INDEX CONCURRENTLY IF NOT EXISTS identity_accounts_user_id_idx ON identity.accounts USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS identity_sessions_expires_at_idx ON identity.sessions USING btree (expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS identity_sessions_user_id_idx ON identity.sessions USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS identity_verifications_expires_at_idx ON identity.verifications USING btree (expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS identity_verifications_identifier_idx ON identity.verifications USING btree (identifier);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS agent_attachment_command_ref ON public.agent_attachment_refs USING btree (attachment_id, command_sequence) WHERE (command_sequence IS NOT NULL);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS agent_attachment_conversation_ref ON public.agent_attachment_refs USING btree (attachment_id, conversation_id) WHERE (conversation_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_attachment_refs_conversation_idx ON public.agent_attachment_refs USING btree (conversation_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_attachments_user_idx ON public.agent_attachments USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_claim_expired ON public.agent_runs USING btree (lease_until, created_at) WHERE ((status = ANY (ARRAY['running'::text, 'cancelling'::text])) AND ((checkpoint ->> 'version'::text) = '2'::text) AND ((checkpoint #>> '{durable,engine}'::text[]) = 'pi-durable/1.4.0'::text));

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_claim_queued ON public.agent_runs USING btree (created_at) WHERE ((status = 'queued'::text) AND ((checkpoint ->> 'version'::text) = '2'::text) AND ((checkpoint #>> '{durable,engine}'::text[]) = 'pi-durable/1.4.0'::text));

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_conversation_runs ON public.agent_runs USING btree (user_id, conversation_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_events_cursor ON public.agent_run_events USING btree (run_id, sequence);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_eval_results_run_idx ON public.agent_eval_results USING btree (run_id, model_id, case_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_eval_runs_created_idx ON public.agent_eval_runs USING btree (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_run_metrics_model ON public.agent_run_metrics USING btree (model_id, ended_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_run_metrics_retention ON public.agent_run_metrics USING btree (ended_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_schedule_runs_active ON public.agent_schedule_runs USING btree (schedule_id) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_schedule_runs_agent_run ON public.agent_schedule_runs USING btree (agent_run_id) WHERE (agent_run_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_schedule_runs_created ON public.agent_schedule_runs USING btree (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_schedules_due ON public.agent_schedules USING btree (next_run_at) WHERE (enabled AND (next_run_at IS NOT NULL));

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_schedules_user ON public.agent_schedules USING btree (user_id, created_at);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS agent_one_active_conversation ON public.agent_runs USING btree (conversation_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text, 'awaiting_input'::text, 'cancelling'::text]));

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_queue ON public.agent_runs USING btree (status, lease_until, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_runs_record_idx ON public.agent_runs USING btree (record_id) WHERE (record_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS archived_sources_kb_idx ON public.archived_sources USING btree (kb_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS archived_sources_source_idx ON public.archived_sources USING btree (source_type, source_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS archived_sources_user_idx ON public.archived_sources USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS billing_ledger_created_idx ON public.billing_ledger USING btree (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS billing_ledger_reference_idx ON public.billing_ledger USING btree (reference_type, reference_id) WHERE (reference_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS billing_ledger_refund_idx ON public.billing_ledger USING btree (reference_id) WHERE (kind = 'refund'::text);

CREATE INDEX CONCURRENTLY IF NOT EXISTS billing_ledger_user_created_idx ON public.billing_ledger USING btree (user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS payment_orders_status_created_idx ON public.payment_orders USING btree (status, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS payment_orders_user_created_idx ON public.payment_orders USING btree (user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS user_subscriptions_user_status_idx ON public.user_subscriptions USING btree (user_id, status, ends_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS bazi_case_events_chart_idx ON public.bazi_case_events USING btree (bazi_chart_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS bazi_case_events_source_run ON public.bazi_case_events USING btree (source_run_id) WHERE (source_run_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS bazi_case_profiles_source_run ON public.bazi_case_profiles USING btree (source_run_id) WHERE (source_run_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS community_comments_post_idx ON public.community_comments USING btree (post_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS community_reports_reporter_idx ON public.community_reports USING btree (reporter_id);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS community_reports_pending_target_unique
  ON public.community_reports USING btree (reporter_id, target_type, target_id)
  WHERE (status = 'pending'::text);

CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_messages_content_trgm ON public.conversation_messages USING gin (content extensions.gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_messages_conversation_created_idx ON public.conversation_messages USING btree (conversation_id, created_at DESC);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS conversation_messages_conversation_sequence_idx ON public.conversation_messages USING btree (conversation_id, sequence);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS conversation_shares_active_conversation_idx ON public.conversation_shares USING btree (conversation_id) WHERE (revoked_at IS NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_shares_user_created_idx ON public.conversation_shares USING btree (user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_title_trgm ON public.conversations USING gin (title extensions.gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_updated_at_idx ON public.conversations USING btree (updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_user_id_idx ON public.conversations USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_gateways_enabled ON public.ai_gateways USING btree (is_enabled);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_model_gateway_bindings_gateway_id ON public.ai_model_gateway_bindings USING btree (gateway_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_model_gateway_bindings_model_id ON public.ai_model_gateway_bindings USING btree (model_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_model_gateway_bindings_priority ON public.ai_model_gateway_bindings USING btree (model_id, priority);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_models_enabled ON public.ai_models USING btree (is_enabled);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_models_vendor ON public.ai_models USING btree (vendor);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_annual_reports_user_year ON public.annual_reports USING btree (user_id, year);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meihua_divinations_conversation_id ON public.meihua_divinations USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meihua_divinations_user_created_at ON public.meihua_divinations USING btree (user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oauth_providers_lookup ON public.user_oauth_providers USING btree (provider, provider_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oauth_providers_user ON public.user_oauth_providers USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheduled_reminders_pending ON public.scheduled_reminders USING btree (scheduled_for) WHERE (sent = false);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_xiaoliuren_divinations_conversation_id ON public.xiaoliuren_divinations USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_xiaoliuren_divinations_user_created_at ON public.xiaoliuren_divinations USING btree (user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_entries_fts_idx ON public.knowledge_entries USING gin (to_tsvector('simple'::regconfig, content));

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_entries_trgm_idx ON public.knowledge_entries USING gin (content extensions.gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_entries_vector_1024_hnsw_idx ON public.knowledge_entries USING hnsw (((content_vector)::extensions.vector(1024)) extensions.vector_cosine_ops) WHERE (embedding_dim = 1024);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ming_records_related_chart ON public.ming_records USING btree (user_id, related_chart_type, related_chart_id) WHERE (related_chart_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ming_records_source_run ON public.ming_records USING btree (source_run_id) WHERE (source_run_id IS NOT NULL);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS notifications_owner_event ON public.notifications USING btree (user_id, event_key) WHERE (event_key IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_annual_reports_owner_idx ON public.annual_reports USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_archived_sources_owner_idx ON public.archived_sources USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_bazi_case_events_owner_idx ON public.bazi_case_events USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_bazi_case_profiles_owner_idx ON public.bazi_case_profiles USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_bazi_charts_owner_idx ON public.bazi_charts USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_community_comments_owner_idx ON public.community_comments USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_community_posts_owner_idx ON public.community_posts USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_community_votes_owner_idx ON public.community_votes USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_conversations_owner_idx ON public.conversations USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_daliuren_divinations_owner_idx ON public.daliuren_divinations USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_face_readings_owner_idx ON public.face_readings USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS generated_images_conversation_idx ON public.generated_images USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS generated_images_run_idx ON public.generated_images USING btree (run_id) WHERE (run_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS generated_images_user_idx ON public.generated_images USING btree (user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_hepan_charts_owner_idx ON public.hepan_charts USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_knowledge_bases_owner_idx ON public.knowledge_bases USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_liuyao_divinations_owner_idx ON public.liuyao_divinations USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_mbti_readings_owner_idx ON public.mbti_readings USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_meihua_divinations_owner_idx ON public.meihua_divinations USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_ming_notes_owner_idx ON public.ming_notes USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_ming_records_owner_idx ON public.ming_records USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_notifications_owner_idx ON public.notifications USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_palm_readings_owner_idx ON public.palm_readings USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_qimen_charts_owner_idx ON public.qimen_charts USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_reminder_subscriptions_owner_idx ON public.reminder_subscriptions USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_scheduled_reminders_owner_idx ON public.scheduled_reminders USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_tarot_readings_owner_idx ON public.tarot_readings USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_user_oauth_providers_owner_idx ON public.user_oauth_providers USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_user_settings_owner_idx ON public.user_settings USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_xiaoliuren_divinations_owner_idx ON public.xiaoliuren_divinations USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS selfhost_ziwei_charts_owner_idx ON public.ziwei_charts USING btree (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS user_agent_memory_source_run_idx ON public.user_agent_memory USING btree (source_run_id) WHERE (source_run_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS user_ai_connections_user_idx ON public.user_ai_connections USING btree (user_id, sort_order, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS user_ai_models_user_idx ON public.user_ai_models USING btree (user_id);
