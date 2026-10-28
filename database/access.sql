-- Row level security, policies and privileges, maintained directly as
-- PostgreSQL SQL. scripts/db/init.mjs recreates only the policies that
-- changed, drops undeclared ones, and revokes every privilege on the managed
-- schemas that is not granted here.

CREATE POLICY "Admins full access" ON public.activation_keys USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

CREATE POLICY "Users can delete own bazi case events" ON public.bazi_case_events FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can delete own bazi case profiles" ON public.bazi_case_profiles FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can delete own conversation messages" ON public.conversation_messages FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = conversation_messages.conversation_id) AND (conversations.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "Users can delete own meihua divinations" ON public.meihua_divinations FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can delete own qimen charts" ON public.qimen_charts FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can delete own xiaoliuren divinations" ON public.xiaoliuren_divinations FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can insert own bazi case events" ON public.bazi_case_events FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can insert own bazi case profiles" ON public.bazi_case_profiles FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can insert own conversation messages" ON public.conversation_messages FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = conversation_messages.conversation_id) AND (conversations.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "Users can insert own daliuren divinations" ON public.daliuren_divinations FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can insert own meihua divinations" ON public.meihua_divinations FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can insert own qimen charts" ON public.qimen_charts FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can insert own xiaoliuren divinations" ON public.xiaoliuren_divinations FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can update own bazi case events" ON public.bazi_case_events FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can update own bazi case profiles" ON public.bazi_case_profiles FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can update own conversation messages" ON public.conversation_messages FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = conversation_messages.conversation_id) AND (conversations.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = conversation_messages.conversation_id) AND (conversations.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "Users can update own daliuren divinations" ON public.daliuren_divinations FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can update own meihua divinations" ON public.meihua_divinations FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can update own xiaoliuren divinations" ON public.xiaoliuren_divinations FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view own bazi case events" ON public.bazi_case_events FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view own bazi case profiles" ON public.bazi_case_profiles FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view own conversation messages" ON public.conversation_messages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = conversation_messages.conversation_id) AND (conversations.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "Users can view own daliuren divinations" ON public.daliuren_divinations FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view own meihua divinations" ON public.meihua_divinations FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view own qimen charts" ON public.qimen_charts FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view own xiaoliuren divinations" ON public.xiaoliuren_divinations FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));

ALTER TABLE public.activation_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_artifacts_read ON public.agent_run_artifacts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.agent_runs r
  WHERE (r.id = agent_run_artifacts.run_id))));

ALTER TABLE public.agent_attachment_refs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_commands_admin ON public.agent_run_commands FOR SELECT TO authenticated USING (public.is_admin_user());

CREATE POLICY agent_credentials_admin ON public.agent_run_credentials FOR SELECT TO authenticated USING (public.is_admin_user());

ALTER TABLE public.agent_durable_commits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_eval_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_eval_cases_admin_all ON public.agent_eval_cases TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT public.is_admin_user() AS is_admin_user));

ALTER TABLE public.agent_eval_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_eval_results_admin_all ON public.agent_eval_results TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT public.is_admin_user() AS is_admin_user));

ALTER TABLE public.agent_eval_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_eval_runs_admin_all ON public.agent_eval_runs TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT public.is_admin_user() AS is_admin_user));

ALTER TABLE public.agent_mcp_servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_mcp_servers_admin_platform ON public.agent_mcp_servers TO authenticated USING (((owner_id IS NULL) AND ( SELECT public.is_admin_user() AS is_admin_user))) WITH CHECK (((owner_id IS NULL) AND ( SELECT public.is_admin_user() AS is_admin_user)));

CREATE POLICY agent_mcp_servers_owner ON public.agent_mcp_servers TO authenticated USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));

CREATE POLICY agent_mcp_servers_worker_read ON public.agent_mcp_servers FOR SELECT TO authenticated USING (public.is_admin_user());

ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_profiles_admin_all ON public.agent_profiles TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT public.is_admin_user() AS is_admin_user));

ALTER TABLE public.agent_run_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_run_metrics_admin_all ON public.agent_run_metrics TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT public.is_admin_user() AS is_admin_user));

ALTER TABLE public.agent_skill_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_skill_files_admin_platform ON public.agent_skill_files TO authenticated USING ((( SELECT public.is_admin_user() AS is_admin_user) AND (EXISTS ( SELECT 1
   FROM public.agent_skills s
  WHERE ((s.id = agent_skill_files.skill_id) AND (s.owner_id IS NULL)))))) WITH CHECK ((( SELECT public.is_admin_user() AS is_admin_user) AND (EXISTS ( SELECT 1
   FROM public.agent_skills s
  WHERE ((s.id = agent_skill_files.skill_id) AND (s.owner_id IS NULL))))));

CREATE POLICY agent_skill_files_owner ON public.agent_skill_files TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.agent_skills s
  WHERE ((s.id = agent_skill_files.skill_id) AND (s.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.agent_skills s
  WHERE ((s.id = agent_skill_files.skill_id) AND (s.owner_id = auth.uid())))));

CREATE POLICY agent_skill_files_worker_read ON public.agent_skill_files FOR SELECT TO authenticated USING (public.is_admin_user());

ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_skills_admin_platform ON public.agent_skills TO authenticated USING (((owner_id IS NULL) AND ( SELECT public.is_admin_user() AS is_admin_user))) WITH CHECK (((owner_id IS NULL) AND ( SELECT public.is_admin_user() AS is_admin_user)));

CREATE POLICY agent_skills_owner ON public.agent_skills TO authenticated USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));

CREATE POLICY agent_skills_worker_read ON public.agent_skills FOR SELECT TO authenticated USING (public.is_admin_user());

ALTER TABLE public.agent_schedule_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_schedule_runs_admin_read ON public.agent_schedule_runs FOR SELECT TO authenticated USING (public.is_admin_user());

CREATE POLICY agent_schedule_runs_owner ON public.agent_schedule_runs TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.agent_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_schedules_admin_read ON public.agent_schedules FOR SELECT TO authenticated USING (public.is_admin_user());

CREATE POLICY agent_schedules_owner ON public.agent_schedules TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

CREATE POLICY agent_events_read ON public.agent_run_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.agent_runs r
  WHERE (r.id = agent_run_events.run_id))));

ALTER TABLE public.agent_run_artifacts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_run_commands ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_run_credentials ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_run_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_runs_read ON public.agent_runs FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin_user()));

ALTER TABLE public.agent_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_workers_admin ON public.agent_workers FOR SELECT TO authenticated USING (public.is_admin_user());

ALTER TABLE public.ai_gateways ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_gateways_admin_all ON public.ai_gateways TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT public.is_admin_user() AS is_admin_user));

ALTER TABLE public.ai_model_gateway_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_model_gateway_bindings_admin_all ON public.ai_model_gateway_bindings TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT public.is_admin_user() AS is_admin_user));

ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_models_delete_access ON public.ai_models FOR DELETE USING (public.is_admin_user());

CREATE POLICY ai_models_insert_access ON public.ai_models FOR INSERT WITH CHECK (public.is_admin_user());

CREATE POLICY ai_models_select_access ON public.ai_models FOR SELECT USING ((public.is_admin_user() OR true));

CREATE POLICY ai_models_update_access ON public.ai_models FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY announcements_admin_delete ON public.announcements FOR DELETE TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user));

CREATE POLICY announcements_admin_insert ON public.announcements FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin_user() AS is_admin_user));

CREATE POLICY announcements_admin_select ON public.announcements FOR SELECT TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user));

CREATE POLICY announcements_admin_update ON public.announcements FOR UPDATE TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT public.is_admin_user() AS is_admin_user));

ALTER TABLE public.annual_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY annual_reports_delete_access ON public.annual_reports FOR DELETE USING (public.is_admin_user());

CREATE POLICY annual_reports_insert_access ON public.annual_reports FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY annual_reports_select_access ON public.annual_reports FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY annual_reports_update_access ON public.annual_reports FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_settings_delete_access ON public.app_settings FOR DELETE USING (public.is_admin_user());

CREATE POLICY app_settings_insert_access ON public.app_settings FOR INSERT WITH CHECK (public.is_admin_user());

CREATE POLICY app_settings_select_access ON public.app_settings FOR SELECT USING (public.is_admin_user());

CREATE POLICY app_settings_update_access ON public.app_settings FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.archived_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY archived_sources_delete_access ON public.archived_sources FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY archived_sources_insert_access ON public.archived_sources FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY archived_sources_select_access ON public.archived_sources FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY archived_sources_update_access ON public.archived_sources FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY attachment_backend_admin ON public.agent_attachments TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

CREATE POLICY attachment_owner_read ON public.agent_attachments FOR SELECT TO authenticated USING (((user_id = auth.uid()) AND (status = 'ready'::text)));

CREATE POLICY attachment_refs_backend_read ON public.agent_attachment_refs FOR SELECT TO authenticated USING (public.is_admin_user());

ALTER TABLE public.bazi_case_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bazi_case_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bazi_charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY bazi_charts_delete_access ON public.bazi_charts FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY bazi_charts_insert_access ON public.bazi_charts FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY bazi_charts_select_access ON public.bazi_charts FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY bazi_charts_update_access ON public.bazi_charts FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_comments_delete_access ON public.community_comments FOR DELETE USING (public.is_admin_user());

CREATE POLICY community_comments_insert_access ON public.community_comments FOR INSERT WITH CHECK ((public.is_admin_user() OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))));

CREATE POLICY community_comments_select_access ON public.community_comments FOR SELECT USING ((public.is_admin_user() OR (is_deleted = false)));

CREATE POLICY community_comments_update_access ON public.community_comments FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_posts_delete_access ON public.community_posts FOR DELETE USING (public.is_admin_user());

CREATE POLICY community_posts_insert_access ON public.community_posts FOR INSERT WITH CHECK ((public.is_admin_user() OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))));

CREATE POLICY community_posts_select_access ON public.community_posts FOR SELECT USING ((public.is_admin_user() OR (is_deleted = false)));

CREATE POLICY community_posts_update_access ON public.community_posts FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (is_deleted = true) OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_reports_delete_access ON public.community_reports FOR DELETE USING (public.is_admin_user());

CREATE POLICY community_reports_insert_access ON public.community_reports FOR INSERT WITH CHECK ((public.is_admin_user() OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = reporter_id))));

CREATE POLICY community_reports_select_access ON public.community_reports FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = reporter_id)));

CREATE POLICY community_reports_update_access ON public.community_reports FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.community_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_votes_delete_access ON public.community_votes FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY community_votes_insert_access ON public.community_votes FOR INSERT WITH CHECK ((public.is_admin_user() OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))));

CREATE POLICY community_votes_select_access ON public.community_votes FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY community_votes_update_access ON public.community_votes FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversation_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversation_shares_owner_select ON public.conversation_shares FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_delete_access ON public.conversations FOR DELETE TO authenticated USING ((( SELECT public.is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY conversations_insert_access ON public.conversations FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY conversations_select_access ON public.conversations FOR SELECT TO authenticated USING ((( SELECT public.is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY conversations_update_access ON public.conversations FOR UPDATE TO authenticated USING ((( SELECT public.is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((( SELECT public.is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_transactions_authenticated_insert_guard ON public.credit_transactions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((public.is_admin_user() IS TRUE));

CREATE POLICY credit_transactions_delete_access ON public.credit_transactions FOR DELETE USING (public.is_admin_user());

CREATE POLICY credit_transactions_insert_access ON public.credit_transactions FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY credit_transactions_select_access ON public.credit_transactions FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY credit_transactions_update_access ON public.credit_transactions FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.daily_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_checkins_delete_access ON public.daily_checkins FOR DELETE USING (public.is_admin_user());

CREATE POLICY daily_checkins_insert_access ON public.daily_checkins FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY daily_checkins_select_access ON public.daily_checkins FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY daily_checkins_update_access ON public.daily_checkins FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.daliuren_divinations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.face_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY face_readings_delete_access ON public.face_readings FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY face_readings_insert_access ON public.face_readings FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY face_readings_select_access ON public.face_readings FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY face_readings_update_access ON public.face_readings FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY generated_images_backend_admin ON public.generated_images TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

CREATE POLICY generated_images_owner_delete ON public.generated_images FOR DELETE TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY generated_images_owner_read ON public.generated_images FOR SELECT TO authenticated USING ((user_id = auth.uid()));

ALTER TABLE public.hepan_charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY hepan_charts_delete_access ON public.hepan_charts FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY hepan_charts_insert_access ON public.hepan_charts FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY hepan_charts_select_access ON public.hepan_charts FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY hepan_charts_update_access ON public.hepan_charts FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_bases_delete_access ON public.knowledge_bases FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY knowledge_bases_insert_access ON public.knowledge_bases FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY knowledge_bases_select_access ON public.knowledge_bases FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY knowledge_bases_update_access ON public.knowledge_bases FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.knowledge_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_entries_delete_access ON public.knowledge_entries FOR DELETE USING ((public.is_admin_user() OR (kb_id IN ( SELECT knowledge_bases.id
   FROM public.knowledge_bases
  WHERE (knowledge_bases.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY knowledge_entries_insert_access ON public.knowledge_entries FOR INSERT WITH CHECK ((public.is_admin_user() OR (kb_id IN ( SELECT knowledge_bases.id
   FROM public.knowledge_bases
  WHERE (knowledge_bases.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY knowledge_entries_select_access ON public.knowledge_entries FOR SELECT USING ((public.is_admin_user() OR (kb_id IN ( SELECT knowledge_bases.id
   FROM public.knowledge_bases
  WHERE (knowledge_bases.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY knowledge_entries_update_access ON public.knowledge_entries FOR UPDATE USING ((public.is_admin_user() OR (kb_id IN ( SELECT knowledge_bases.id
   FROM public.knowledge_bases
  WHERE (knowledge_bases.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((public.is_admin_user() OR (kb_id IN ( SELECT knowledge_bases.id
   FROM public.knowledge_bases
  WHERE (knowledge_bases.user_id = ( SELECT auth.uid() AS uid))))));

ALTER TABLE public.liuyao_divinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY liuyao_divinations_delete_access ON public.liuyao_divinations FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY liuyao_divinations_insert_access ON public.liuyao_divinations FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY liuyao_divinations_select_access ON public.liuyao_divinations FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY liuyao_divinations_update_access ON public.liuyao_divinations FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.mbti_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY mbti_readings_delete_access ON public.mbti_readings FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY mbti_readings_insert_access ON public.mbti_readings FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY mbti_readings_select_access ON public.mbti_readings FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY mbti_readings_update_access ON public.mbti_readings FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.meihua_divinations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ming_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY ming_notes_delete_access ON public.ming_notes FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY ming_notes_insert_access ON public.ming_notes FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY ming_notes_select_access ON public.ming_notes FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY ming_notes_update_access ON public.ming_notes FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.ming_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY ming_records_delete_access ON public.ming_records FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY ming_records_insert_access ON public.ming_records FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY ming_records_select_access ON public.ming_records FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY ming_records_update_access ON public.ming_records FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_delete_admin_access ON public.notifications FOR DELETE TO authenticated USING (( SELECT public.is_admin_user() AS is_admin_user));

CREATE POLICY notifications_insert_admin_access ON public.notifications FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin_user() AS is_admin_user));

CREATE POLICY notifications_select_access ON public.notifications FOR SELECT TO authenticated USING ((( SELECT public.is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY notifications_update_access ON public.notifications FOR UPDATE TO authenticated USING ((( SELECT public.is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((( SELECT public.is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.palm_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY palm_readings_delete_access ON public.palm_readings FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY palm_readings_insert_access ON public.palm_readings FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY palm_readings_select_access ON public.palm_readings FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY palm_readings_update_access ON public.palm_readings FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.prompt_enhancement_usage ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.qimen_charts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reminder_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY reminder_subscriptions_delete_access ON public.reminder_subscriptions FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY reminder_subscriptions_insert_access ON public.reminder_subscriptions FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY reminder_subscriptions_select_access ON public.reminder_subscriptions FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY reminder_subscriptions_update_access ON public.reminder_subscriptions FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.scheduled_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduled_reminders_delete_access ON public.scheduled_reminders FOR DELETE USING (public.is_admin_user());

CREATE POLICY scheduled_reminders_insert_access ON public.scheduled_reminders FOR INSERT WITH CHECK (public.is_admin_user());

CREATE POLICY scheduled_reminders_select_access ON public.scheduled_reminders FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY scheduled_reminders_update_access ON public.scheduled_reminders FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.tarot_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tarot_readings_delete_access ON public.tarot_readings FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY tarot_readings_insert_access ON public.tarot_readings FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY tarot_readings_select_access ON public.tarot_readings FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY tarot_readings_update_access ON public.tarot_readings FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.user_agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_agent_memory_owner ON public.user_agent_memory TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

CREATE POLICY user_agent_memory_worker_read ON public.user_agent_memory FOR SELECT TO authenticated USING (public.is_admin_user());

ALTER TABLE public.user_oauth_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_oauth_providers_delete_access ON public.user_oauth_providers FOR DELETE USING (public.is_admin_user());

CREATE POLICY user_oauth_providers_insert_access ON public.user_oauth_providers FOR INSERT WITH CHECK (public.is_admin_user());

CREATE POLICY user_oauth_providers_select_access ON public.user_oauth_providers FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY user_oauth_providers_update_access ON public.user_oauth_providers FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_settings_delete_access ON public.user_settings FOR DELETE USING (public.is_admin_user());

CREATE POLICY user_settings_insert_access ON public.user_settings FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY user_settings_select_access ON public.user_settings FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY user_settings_update_access ON public.user_settings FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_delete_access ON public.users FOR DELETE USING (public.is_admin_user());

CREATE POLICY users_insert_access ON public.users FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = id)));

CREATE POLICY users_select_access ON public.users FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = id)));

CREATE POLICY users_update_access ON public.users FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = id)));

ALTER TABLE public.xiaoliuren_divinations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ziwei_charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ziwei_charts_delete_access ON public.ziwei_charts FOR DELETE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY ziwei_charts_insert_access ON public.ziwei_charts FOR INSERT WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY ziwei_charts_select_access ON public.ziwei_charts FOR SELECT USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

CREATE POLICY ziwei_charts_update_access ON public.ziwei_charts FOR UPDATE USING ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((public.is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));

GRANT USAGE ON SCHEMA auth TO anon;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA auth TO taibu_app;

GRANT USAGE ON SCHEMA extensions TO anon;
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT USAGE ON SCHEMA extensions TO taibu_app;

GRANT USAGE ON SCHEMA identity TO taibu_auth;

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT ALL ON FUNCTION auth.uid() TO anon;
GRANT ALL ON FUNCTION auth.uid() TO authenticated;
GRANT ALL ON FUNCTION auth.uid() TO taibu_app;

GRANT ALL ON FUNCTION public.activate_key_as_service(p_user_id uuid, p_key_code text) TO authenticated;

GRANT ALL ON FUNCTION public.admin_get_auth_user_emails(p_user_ids uuid[]) TO authenticated;

GRANT ALL ON FUNCTION public.agent_admin_task_log(p_run_id uuid, p_after bigint) TO authenticated;

GRANT SELECT ON TABLE public.agent_runs TO authenticated;

GRANT SELECT ON TABLE public.agent_run_artifacts TO authenticated;

GRANT ALL ON FUNCTION public.agent_cache_tool(p_run_id uuid, p_worker_id text, p_fence bigint, p_call_id text, p_tool_name text, p_kind text, p_args jsonb, p_result jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.agent_cancel_run(p_run_id uuid) TO authenticated;

GRANT SELECT ON TABLE public.agent_run_commands TO authenticated;

GRANT ALL ON FUNCTION public.agent_change_command(p_run_id uuid, p_sequence bigint, p_revision integer, p_action text, p_payload jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.agent_checkpoint(p_run_id uuid, p_worker_id text, p_fence bigint, p_checkpoint jsonb, p_message jsonb, p_event jsonb, p_command bigint) TO authenticated;

GRANT ALL ON FUNCTION public.agent_claim_command(p_run_id uuid, p_worker_id text, p_fence bigint, p_sequence bigint) TO authenticated;

GRANT ALL ON FUNCTION public.agent_claim_run(p_worker_id text) TO authenticated;

GRANT ALL ON FUNCTION public.agent_create_run(p_id uuid, p_user_id uuid, p_conversation_id uuid, p_request_id text, p_request_hash text, p_input jsonb, p_checkpoint jsonb, p_message jsonb, p_credential jsonb, p_charge boolean) TO authenticated;

GRANT ALL ON FUNCTION public.agent_durable_commit(p_run_id uuid, p_worker_id text, p_fence bigint, p_sequence bigint, p_writes jsonb, p_checkpoint jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.agent_durable_read(p_run_id uuid, p_worker_id text, p_fence bigint, p_after bigint) TO authenticated;

GRANT ALL ON FUNCTION public.agent_finish_run(p_run_id uuid, p_worker_id text, p_fence bigint, p_status text, p_checkpoint jsonb, p_message jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.agent_record_user_event(p_run_id uuid, p_worker_id text, p_fence bigint, p_call_id text, p_chart_type text, p_chart_id uuid, p_event_date date, p_category text, p_title text, p_evidence text) TO authenticated;

GRANT ALL ON FUNCTION public.agent_renew_lease(p_run_id uuid, p_worker_id text, p_fence bigint) TO authenticated;

GRANT ALL ON FUNCTION public.agent_run_metrics_summary(p_days integer) TO authenticated;

GRANT ALL ON FUNCTION public.agent_save_archive_proposal(p_run_id uuid, p_call_id text) TO authenticated;

GRANT ALL ON FUNCTION public.agent_search_conversations(p_run_id uuid, p_worker_id text, p_fence bigint, p_query text, p_limit integer) TO authenticated;

GRANT ALL ON FUNCTION public.agent_search_knowledge(p_run_id uuid, p_worker_id text, p_fence bigint, p_method text, p_args jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.agent_submit_command(p_run_id uuid, p_request_id text, p_mode text, p_message jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.agent_worker_heartbeat(p_worker_id text, p_engine text) TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_agent_memory TO authenticated;

GRANT ALL ON FUNCTION public.agent_write_memory(p_run_id uuid, p_worker_id text, p_fence bigint, p_title text, p_content text, p_kind text, p_evidence text) TO authenticated;

GRANT ALL ON FUNCTION public.batch_update_vectors(p_updates jsonb, p_expected_dim integer, p_force_overwrite boolean) TO authenticated;

GRANT ALL ON FUNCTION public.batch_update_vectors_as_service(p_updates jsonb, p_user_id uuid, p_expected_dim integer, p_force_overwrite boolean) TO authenticated;

GRANT ALL ON FUNCTION public.check_vector_index_exists(p_dim integer) TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_attachments TO authenticated;

GRANT SELECT,INSERT,DELETE ON TABLE public.generated_images TO authenticated;

GRANT ALL ON FUNCTION public.claim_agent_attachment_cleanup(p_limit integer) TO authenticated;

GRANT ALL ON FUNCTION public.claim_linuxdo_membership_as_service(p_user_id uuid, p_plan_id text, p_trust_level integer, p_provider_user_id text) TO authenticated;

GRANT ALL ON FUNCTION public.claim_notification_popup(p_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.claim_prompt_enhancement() TO authenticated;

GRANT ALL ON FUNCTION public.cleanup_expired_identity_rows(p_limit integer) TO authenticated;

GRANT ALL ON FUNCTION public.community_author_profiles(p_user_ids uuid[]) TO authenticated;

GRANT ALL ON FUNCTION public.community_author_profiles(p_user_ids uuid[]) TO anon;

GRANT ALL ON FUNCTION public.create_analysis_conversation_with_history_as_service(p_user_id uuid, p_source_type text, p_source_data jsonb, p_title text, p_personality text, p_messages jsonb, p_history_type text, p_history_payload jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.create_conversation_with_messages(p_user_id uuid, p_title text, p_personality text, p_source_type text, p_source_data jsonb, p_messages jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.create_knowledge_base_with_limit(p_user_id uuid, p_name text, p_description text, p_weight text, p_limit integer) TO authenticated;

GRANT ALL ON FUNCTION public.increment_community_post_view_count(post_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.increment_community_post_view_count(post_id uuid) TO anon;

GRANT ALL ON FUNCTION public.decrement_ai_chat_count(user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.delete_agent_retention(p_event_days integer, p_commit_days integer, p_worker_hours integer, p_limit integer, p_metric_days integer) TO authenticated;

GRANT ALL ON FUNCTION public.delete_conversation_graph(p_conversation_id text) TO authenticated;

GRANT ALL ON FUNCTION public.delete_history_item_and_conversation(p_history_type text, p_history_id text) TO authenticated;

GRANT ALL ON FUNCTION public.fork_conversation_snapshot(p_parent uuid, p_through text, p_source_messages jsonb, p_messages jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.get_conversation_share(p_token text) TO anon;
GRANT ALL ON FUNCTION public.get_conversation_share(p_token text) TO authenticated;

GRANT ALL ON FUNCTION public.get_shared_generated_image(p_token text, p_image uuid) TO anon;
GRANT ALL ON FUNCTION public.get_shared_generated_image(p_token text, p_image uuid) TO authenticated;

GRANT ALL ON FUNCTION public.decrement_ai_chat_count_by(user_id uuid, amount integer) TO authenticated;

GRANT ALL ON FUNCTION public.import_ming_records_and_notes(p_records jsonb, p_notes jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.increment_ai_chat_count(user_id uuid, amount integer) TO authenticated;

GRANT ALL ON FUNCTION public.is_admin_user() TO authenticated;

GRANT ALL ON FUNCTION public.kb_replace_source_entries(p_kb_id uuid, p_source_type text, p_source_id text, p_entries jsonb, p_archive boolean) TO authenticated;

GRANT ALL ON FUNCTION public.kb_unarchive_source_as_service(p_user_id uuid, p_kb_id uuid, p_source_type text, p_source_id text) TO authenticated;

GRANT ALL ON FUNCTION public.perform_daily_checkin_as_service(p_user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.process_scheduled_reminder_delivery_as_service(p_reminder_id uuid, p_stale_before timestamp with time zone, p_notification_title text, p_notification_content text, p_notification_link text) TO authenticated;

GRANT ALL ON FUNCTION public.replace_conversation_messages(p_conversation_id uuid, p_messages jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.revoke_conversation_share(p_conversation uuid) TO authenticated;

GRANT ALL ON FUNCTION public.save_bazi_case_profile_as_service(p_user_id uuid, p_chart_id uuid, p_master_review jsonb, p_owner_feedback jsonb, p_events jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.schedule_reminder_if_absent_as_service(p_user_id uuid, p_reminder_type text, p_scheduled_for timestamp with time zone, p_content jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.search_conversation_messages(p_query text, p_limit integer) TO authenticated;

GRANT ALL ON FUNCTION public.search_knowledge_fts(p_query text, p_kb_ids uuid[], p_limit integer, p_config text) TO authenticated;

GRANT ALL ON FUNCTION public.search_knowledge_trigram(p_query text, p_kb_ids uuid[], p_limit integer, p_threshold real) TO authenticated;

GRANT ALL ON FUNCTION public.search_knowledge_vector(p_query_vector double precision[], p_kb_ids uuid[], p_limit integer, p_dim integer) TO authenticated;

GRANT ALL ON FUNCTION public.submit_community_report_and_notify(p_target_type text, p_target_id uuid, p_reason text, p_description text) TO authenticated;

GRANT ALL ON FUNCTION public.toggle_ming_record_pin(p_record_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.toggle_community_vote(p_target_type text, p_target_id uuid, p_vote_type text) TO authenticated;

GRANT ALL ON FUNCTION public.update_conversation_with_messages(p_conversation_id uuid, p_title text, p_title_present boolean, p_personality text, p_personality_present boolean, p_messages jsonb, p_messages_present boolean) TO authenticated;

GRANT SELECT ON TABLE public.conversation_shares TO authenticated;

GRANT ALL ON FUNCTION public.upsert_conversation_share(p_conversation uuid, p_token text, p_title text, p_snapshot jsonb, p_include_charts boolean, p_source_updated_at timestamp with time zone) TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE identity.accounts TO taibu_auth;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE identity.sessions TO taibu_auth;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE identity.users TO taibu_auth;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE identity.verifications TO taibu_auth;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.activation_keys TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.activation_keys TO anon;

GRANT SELECT ON TABLE public.agent_attachment_refs TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_eval_cases TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_eval_results TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_eval_runs TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_mcp_servers TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_profiles TO authenticated;

GRANT SELECT ON TABLE public.agent_run_credentials TO authenticated;

GRANT SELECT ON TABLE public.agent_run_events TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_run_metrics TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_skill_files TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_skills TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_schedule_runs TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_schedules TO authenticated;

GRANT ALL ON FUNCTION public.agent_latest_schedule_occurrence(p_cadence jsonb, p_timezone text, p_before timestamp with time zone) TO authenticated;

GRANT ALL ON FUNCTION public.agent_local_to_utc(p_local timestamp without time zone, p_timezone text) TO authenticated;

GRANT ALL ON FUNCTION public.agent_next_run_at(p_cadence jsonb, p_timezone text, p_after timestamp with time zone) TO authenticated;

GRANT ALL ON FUNCTION public.claim_agent_schedules(p_limit integer) TO authenticated;

GRANT ALL ON FUNCTION public.create_agent_schedule(p_name text, p_template text, p_prompt text, p_cadence jsonb, p_timezone text, p_options jsonb, p_limit integer) TO authenticated;

GRANT ALL ON FUNCTION public.create_agent_schedule_run(p_schedule_id uuid, p_user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.enforce_agent_schedule_limits(p_limits jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.settle_agent_schedule_run(p_run_id uuid, p_status text, p_agent_run_id uuid, p_error text, p_skip_reason text) TO authenticated;

GRANT ALL ON FUNCTION public.update_agent_schedule(p_id uuid, p_name text, p_prompt text, p_cadence jsonb, p_timezone text, p_options jsonb, p_enabled boolean) TO authenticated;

GRANT SELECT ON TABLE public.agent_workers TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_gateways TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_gateways TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_model_gateway_bindings TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_model_gateway_bindings TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_models TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_models TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.announcements TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.announcements TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.annual_reports TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.annual_reports TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_settings TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_settings TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.archived_sources TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.archived_sources TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bazi_case_events TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bazi_case_events TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bazi_case_profiles TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bazi_case_profiles TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bazi_charts TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bazi_charts TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.community_comments TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.community_comments TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.community_posts TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.community_posts TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.community_reports TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.community_reports TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.community_votes TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.community_votes TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversation_messages TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversation_messages TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversations TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversations TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversations_with_archive_status TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversations_with_archive_status TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.credit_transactions TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.credit_transactions TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.daily_checkins TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.daily_checkins TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.daliuren_divinations TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.daliuren_divinations TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.face_readings TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.face_readings TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hepan_charts TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hepan_charts TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.knowledge_bases TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.knowledge_bases TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.knowledge_entries TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.knowledge_entries TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.liuyao_divinations TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.liuyao_divinations TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mbti_readings TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mbti_readings TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meihua_divinations TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meihua_divinations TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ming_notes TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ming_notes TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ming_records TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ming_records TO anon;

GRANT SELECT ON TABLE public.ming_records_with_archive_status TO anon;
GRANT SELECT ON TABLE public.ming_records_with_archive_status TO authenticated;

GRANT SELECT,INSERT,DELETE ON TABLE public.notifications TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO anon;

GRANT UPDATE(is_read) ON TABLE public.notifications TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.palm_readings TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.palm_readings TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qimen_charts TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.qimen_charts TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.reminder_subscriptions TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.reminder_subscriptions TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scheduled_reminders TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scheduled_reminders TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tarot_readings TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tarot_readings TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_oauth_providers TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_oauth_providers TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_settings TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_settings TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.xiaoliuren_divinations TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.xiaoliuren_divinations TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ziwei_charts TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ziwei_charts TO anon;
