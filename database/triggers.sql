-- Current definitions. Safe to apply repeatedly; no migration history.
-- Maintained directly as PostgreSQL SQL.

DROP TRIGGER IF EXISTS on_identity_user_created ON identity.users;
CREATE TRIGGER on_identity_user_created AFTER INSERT ON identity.users FOR EACH ROW EXECUTE FUNCTION identity.handle_user_created();

DROP TRIGGER IF EXISTS agent_archive_record_edited ON public.ming_records;
CREATE TRIGGER agent_archive_record_edited BEFORE UPDATE OF title, content, category, event_date ON public.ming_records FOR EACH ROW WHEN ((old.source_run_id IS NOT NULL)) EXECUTE FUNCTION public.agent_archive_record_edited();

DROP TRIGGER IF EXISTS agent_archive_source_guard ON public.bazi_case_events;
CREATE TRIGGER agent_archive_source_guard BEFORE INSERT OR UPDATE OF source_run_id, user_id ON public.bazi_case_events FOR EACH ROW WHEN ((new.source_run_id IS NOT NULL)) EXECUTE FUNCTION public.agent_archive_source_guard();

DROP TRIGGER IF EXISTS agent_archive_source_guard ON public.bazi_case_profiles;
CREATE TRIGGER agent_archive_source_guard BEFORE INSERT OR UPDATE OF source_run_id, user_id ON public.bazi_case_profiles FOR EACH ROW WHEN ((new.source_run_id IS NOT NULL)) EXECUTE FUNCTION public.agent_archive_source_guard();

DROP TRIGGER IF EXISTS agent_archive_source_guard ON public.ming_records;
CREATE TRIGGER agent_archive_source_guard BEFORE INSERT OR UPDATE OF source_run_id, user_id ON public.ming_records FOR EACH ROW WHEN ((new.source_run_id IS NOT NULL)) EXECUTE FUNCTION public.agent_archive_source_guard();

DROP TRIGGER IF EXISTS agent_cancel_pending ON public.agent_runs;
CREATE TRIGGER agent_cancel_pending AFTER UPDATE OF cancel_requested, status ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.agent_cancel_pending_commands();

DROP TRIGGER IF EXISTS agent_command_delivery ON public.agent_run_commands;
CREATE TRIGGER agent_command_delivery BEFORE UPDATE ON public.agent_run_commands FOR EACH ROW EXECUTE FUNCTION public.agent_command_delivery_state();

DROP TRIGGER IF EXISTS agent_conversation_delete_guard ON public.conversations;
CREATE TRIGGER agent_conversation_delete_guard BEFORE DELETE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.agent_protect_conversation_delete();

DROP TRIGGER IF EXISTS agent_conversation_message_guard ON public.conversations;
CREATE TRIGGER agent_conversation_message_guard BEFORE UPDATE OF messages ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.agent_protect_conversation_messages();

DROP TRIGGER IF EXISTS agent_memory_guard ON public.user_agent_memory;
CREATE TRIGGER agent_memory_guard BEFORE INSERT OR UPDATE ON public.user_agent_memory FOR EACH ROW EXECUTE FUNCTION public.agent_memory_guard();

DROP TRIGGER IF EXISTS agent_normalized_message_guard ON public.conversation_messages;
CREATE TRIGGER agent_normalized_message_guard BEFORE INSERT OR DELETE OR UPDATE ON public.conversation_messages FOR EACH ROW EXECUTE FUNCTION public.agent_protect_normalized_messages();

DROP TRIGGER IF EXISTS agent_notify_command ON public.agent_run_commands;
CREATE TRIGGER agent_notify_command AFTER INSERT ON public.agent_run_commands FOR EACH ROW EXECUTE FUNCTION public.agent_notify_command();

DROP TRIGGER IF EXISTS agent_notify_event ON public.agent_run_events;
CREATE TRIGGER agent_notify_event AFTER INSERT ON public.agent_run_events FOR EACH ROW EXECUTE FUNCTION public.agent_notify_event();

DROP TRIGGER IF EXISTS agent_notify_run ON public.agent_runs;
CREATE TRIGGER agent_notify_run AFTER INSERT OR UPDATE OF status, cancel_requested ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.agent_notify_run();

DROP TRIGGER IF EXISTS agent_task_notice ON public.agent_runs;
CREATE TRIGGER agent_task_notice AFTER UPDATE OF status ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.agent_task_notification();

DROP TRIGGER IF EXISTS ai_gateways_updated_at ON public.ai_gateways;
CREATE TRIGGER ai_gateways_updated_at BEFORE UPDATE ON public.ai_gateways FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

DROP TRIGGER IF EXISTS ai_model_gateway_bindings_updated_at ON public.ai_model_gateway_bindings;
CREATE TRIGGER ai_model_gateway_bindings_updated_at BEFORE UPDATE ON public.ai_model_gateway_bindings FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

DROP TRIGGER IF EXISTS ai_models_updated_at ON public.ai_models;
CREATE TRIGGER ai_models_updated_at BEFORE UPDATE ON public.ai_models FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

DROP TRIGGER IF EXISTS attachment_ref_removed ON public.agent_attachment_refs;
CREATE TRIGGER attachment_ref_removed AFTER DELETE ON public.agent_attachment_refs FOR EACH ROW EXECUTE FUNCTION public.orphan_agent_attachment();

DROP TRIGGER IF EXISTS command_attachment_refs ON public.agent_run_commands;
CREATE TRIGGER command_attachment_refs AFTER INSERT OR UPDATE OF message, delivery_state ON public.agent_run_commands FOR EACH ROW EXECUTE FUNCTION public.sync_agent_attachment_refs();

DROP TRIGGER IF EXISTS conversation_attachment_refs ON public.conversations;
CREATE TRIGGER conversation_attachment_refs AFTER INSERT OR UPDATE OF messages ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.sync_agent_attachment_refs();

DROP TRIGGER IF EXISTS conversations_updated_at ON public.conversations;
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_conversations_updated_at();

DROP TRIGGER IF EXISTS fork_history_read_only ON public.conversations;
CREATE TRIGGER fork_history_read_only BEFORE UPDATE OF messages ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.protect_fork_history();

DROP TRIGGER IF EXISTS guard_user_entitlement_writes ON public.users;
CREATE TRIGGER guard_user_entitlement_writes BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_user_entitlement_writes();
