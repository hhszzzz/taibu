-- Triggers, maintained directly as PostgreSQL SQL. scripts/db/init.mjs
-- recreates only the triggers that changed and drops undeclared ones.

CREATE TRIGGER on_identity_user_created AFTER INSERT ON identity.users FOR EACH ROW EXECUTE FUNCTION identity.handle_user_created();

CREATE TRIGGER agent_archive_record_edited BEFORE UPDATE OF title, content, category, event_date ON public.ming_records FOR EACH ROW WHEN ((old.source_run_id IS NOT NULL)) EXECUTE FUNCTION public.agent_archive_record_edited();

CREATE TRIGGER agent_archive_source_guard BEFORE INSERT OR UPDATE OF source_run_id, user_id ON public.bazi_case_events FOR EACH ROW WHEN ((new.source_run_id IS NOT NULL)) EXECUTE FUNCTION public.agent_archive_source_guard();

CREATE TRIGGER agent_archive_source_guard BEFORE INSERT OR UPDATE OF source_run_id, user_id ON public.bazi_case_profiles FOR EACH ROW WHEN ((new.source_run_id IS NOT NULL)) EXECUTE FUNCTION public.agent_archive_source_guard();

CREATE TRIGGER agent_archive_source_guard BEFORE INSERT OR UPDATE OF source_run_id, user_id ON public.ming_records FOR EACH ROW WHEN ((new.source_run_id IS NOT NULL)) EXECUTE FUNCTION public.agent_archive_source_guard();

CREATE TRIGGER agent_cancel_pending AFTER UPDATE OF cancel_requested, status ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.agent_cancel_pending_commands();

CREATE TRIGGER agent_command_delivery BEFORE UPDATE ON public.agent_run_commands FOR EACH ROW EXECUTE FUNCTION public.agent_command_delivery_state();

CREATE TRIGGER agent_conversation_delete_guard BEFORE DELETE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.agent_protect_conversation_delete();

CREATE TRIGGER agent_conversation_message_guard BEFORE UPDATE OF messages ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.agent_protect_conversation_messages();

CREATE TRIGGER agent_mcp_servers_updated_at BEFORE UPDATE ON public.agent_mcp_servers FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

CREATE TRIGGER agent_memory_guard BEFORE INSERT OR UPDATE ON public.user_agent_memory FOR EACH ROW EXECUTE FUNCTION public.agent_memory_guard();

CREATE TRIGGER agent_normalized_message_guard BEFORE INSERT OR DELETE OR UPDATE ON public.conversation_messages FOR EACH ROW EXECUTE FUNCTION public.agent_protect_normalized_messages();

CREATE TRIGGER agent_notify_command AFTER INSERT ON public.agent_run_commands FOR EACH ROW EXECUTE FUNCTION public.agent_notify_command();

CREATE TRIGGER agent_notify_event AFTER INSERT ON public.agent_run_events FOR EACH ROW EXECUTE FUNCTION public.agent_notify_event();

CREATE TRIGGER agent_notify_run AFTER INSERT OR UPDATE OF status, cancel_requested ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.agent_notify_run();

CREATE TRIGGER agent_task_notice AFTER UPDATE OF status ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.agent_task_notification();

CREATE TRIGGER ai_gateways_updated_at BEFORE UPDATE ON public.ai_gateways FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

CREATE TRIGGER ai_model_gateway_bindings_updated_at BEFORE UPDATE ON public.ai_model_gateway_bindings FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

CREATE TRIGGER ai_models_updated_at BEFORE UPDATE ON public.ai_models FOR EACH ROW EXECUTE FUNCTION public.update_ai_model_updated_at();

CREATE TRIGGER attachment_ref_removed AFTER DELETE ON public.agent_attachment_refs FOR EACH ROW EXECUTE FUNCTION public.orphan_agent_attachment();

CREATE TRIGGER command_attachment_refs AFTER INSERT OR UPDATE OF message, delivery_state ON public.agent_run_commands FOR EACH ROW EXECUTE FUNCTION public.sync_agent_attachment_refs();

CREATE TRIGGER conversation_attachment_refs AFTER INSERT OR UPDATE OF messages ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.sync_agent_attachment_refs();

CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_conversations_updated_at();

CREATE TRIGGER fork_history_read_only BEFORE UPDATE OF messages ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.protect_fork_history();

CREATE TRIGGER guard_user_entitlement_writes BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_user_entitlement_writes();
