-- Align the self-host baseline RLS policies with production.
-- Generated from the production catalog reconstruction on 2026-10-22.
-- The baseline 0002 was generated from the legacy selfhost schema, whose
-- selfhost_* policies are not the production policy set. Production is the
-- source of truth for cutover; this migration replaces the former with the
-- latter and leaves the pending agent/share policies untouched.

SET search_path = public, extensions, auth, pg_temp;

-- remove selfhost-only policies
DROP POLICY IF EXISTS "selfhost_admin" ON public."activation_keys";
DROP POLICY IF EXISTS "selfhost_admin" ON public."ai_gateways";
DROP POLICY IF EXISTS "selfhost_gateways_read" ON public."ai_gateways";
DROP POLICY IF EXISTS "selfhost_admin" ON public."ai_model_gateway_bindings";
DROP POLICY IF EXISTS "selfhost_bindings_read" ON public."ai_model_gateway_bindings";
DROP POLICY IF EXISTS "selfhost_admin" ON public."ai_models";
DROP POLICY IF EXISTS "selfhost_models_read" ON public."ai_models";
DROP POLICY IF EXISTS "selfhost_admin" ON public."announcements";
DROP POLICY IF EXISTS "selfhost_announcements_read" ON public."announcements";
DROP POLICY IF EXISTS "selfhost_admin" ON public."annual_reports";
DROP POLICY IF EXISTS "selfhost_owner_read" ON public."annual_reports";
DROP POLICY IF EXISTS "selfhost_admin" ON public."app_settings";
DROP POLICY IF EXISTS "selfhost_settings_read" ON public."app_settings";
DROP POLICY IF EXISTS "selfhost_admin" ON public."archived_sources";
DROP POLICY IF EXISTS "selfhost_owner" ON public."archived_sources";
DROP POLICY IF EXISTS "selfhost_admin" ON public."bazi_case_events";
DROP POLICY IF EXISTS "selfhost_owner_read" ON public."bazi_case_events";
DROP POLICY IF EXISTS "selfhost_admin" ON public."bazi_case_profiles";
DROP POLICY IF EXISTS "selfhost_owner_read" ON public."bazi_case_profiles";
DROP POLICY IF EXISTS "selfhost_admin" ON public."bazi_charts";
DROP POLICY IF EXISTS "selfhost_owner" ON public."bazi_charts";
DROP POLICY IF EXISTS "selfhost_admin" ON public."conversation_messages";
DROP POLICY IF EXISTS "selfhost_message_owner" ON public."conversation_messages";
DROP POLICY IF EXISTS "selfhost_admin" ON public."conversations";
DROP POLICY IF EXISTS "selfhost_owner" ON public."conversations";
DROP POLICY IF EXISTS "selfhost_admin" ON public."credit_transactions";
DROP POLICY IF EXISTS "selfhost_owner_read" ON public."credit_transactions";
DROP POLICY IF EXISTS "selfhost_admin" ON public."daily_checkins";
DROP POLICY IF EXISTS "selfhost_owner_read" ON public."daily_checkins";
DROP POLICY IF EXISTS "selfhost_admin" ON public."daliuren_divinations";
DROP POLICY IF EXISTS "selfhost_owner" ON public."daliuren_divinations";
DROP POLICY IF EXISTS "selfhost_admin" ON public."face_readings";
DROP POLICY IF EXISTS "selfhost_owner" ON public."face_readings";
DROP POLICY IF EXISTS "selfhost_admin" ON public."hepan_charts";
DROP POLICY IF EXISTS "selfhost_owner" ON public."hepan_charts";
DROP POLICY IF EXISTS "selfhost_admin" ON public."knowledge_bases";
DROP POLICY IF EXISTS "selfhost_owner" ON public."knowledge_bases";
DROP POLICY IF EXISTS "selfhost_admin" ON public."knowledge_entries";
DROP POLICY IF EXISTS "selfhost_knowledge_entries_owner" ON public."knowledge_entries";
DROP POLICY IF EXISTS "selfhost_admin" ON public."liuyao_divinations";
DROP POLICY IF EXISTS "selfhost_owner" ON public."liuyao_divinations";
DROP POLICY IF EXISTS "selfhost_admin" ON public."mbti_readings";
DROP POLICY IF EXISTS "selfhost_owner" ON public."mbti_readings";
DROP POLICY IF EXISTS "selfhost_admin" ON public."meihua_divinations";
DROP POLICY IF EXISTS "selfhost_owner" ON public."meihua_divinations";
DROP POLICY IF EXISTS "selfhost_admin" ON public."ming_notes";
DROP POLICY IF EXISTS "selfhost_owner" ON public."ming_notes";
DROP POLICY IF EXISTS "selfhost_admin" ON public."ming_records";
DROP POLICY IF EXISTS "selfhost_owner" ON public."ming_records";
DROP POLICY IF EXISTS "selfhost_admin" ON public."notifications";
DROP POLICY IF EXISTS "selfhost_notification_read_flag" ON public."notifications";
DROP POLICY IF EXISTS "selfhost_owner_read" ON public."notifications";
DROP POLICY IF EXISTS "selfhost_admin" ON public."palm_readings";
DROP POLICY IF EXISTS "selfhost_owner" ON public."palm_readings";
DROP POLICY IF EXISTS "selfhost_admin" ON public."qimen_charts";
DROP POLICY IF EXISTS "selfhost_owner" ON public."qimen_charts";
DROP POLICY IF EXISTS "selfhost_admin" ON public."reminder_subscriptions";
DROP POLICY IF EXISTS "selfhost_owner" ON public."reminder_subscriptions";
DROP POLICY IF EXISTS "selfhost_admin" ON public."scheduled_reminders";
DROP POLICY IF EXISTS "selfhost_owner_read" ON public."scheduled_reminders";
DROP POLICY IF EXISTS "selfhost_admin" ON public."tarot_readings";
DROP POLICY IF EXISTS "selfhost_owner" ON public."tarot_readings";
DROP POLICY IF EXISTS "selfhost_admin" ON public."user_oauth_providers";
DROP POLICY IF EXISTS "selfhost_owner_read" ON public."user_oauth_providers";
DROP POLICY IF EXISTS "selfhost_admin" ON public."user_settings";
DROP POLICY IF EXISTS "selfhost_owner" ON public."user_settings";
DROP POLICY IF EXISTS "selfhost_admin" ON public."users";
DROP POLICY IF EXISTS "selfhost_profile_insert" ON public."users";
DROP POLICY IF EXISTS "selfhost_profile_read" ON public."users";
DROP POLICY IF EXISTS "selfhost_profile_update" ON public."users";
DROP POLICY IF EXISTS "selfhost_admin" ON public."xiaoliuren_divinations";
DROP POLICY IF EXISTS "selfhost_owner" ON public."xiaoliuren_divinations";
DROP POLICY IF EXISTS "selfhost_admin" ON public."ziwei_charts";
DROP POLICY IF EXISTS "selfhost_owner" ON public."ziwei_charts";

-- install the production policies
CREATE POLICY "Admins full access" ON public."activation_keys" FOR ALL TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "ai_gateways_admin_all" ON public."ai_gateways" FOR ALL TO "authenticated" USING (( SELECT is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT is_admin_user() AS is_admin_user));
CREATE POLICY "ai_model_gateway_bindings_admin_all" ON public."ai_model_gateway_bindings" FOR ALL TO "authenticated" USING (( SELECT is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT is_admin_user() AS is_admin_user));
CREATE POLICY "ai_models_delete_access" ON public."ai_models" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "ai_models_insert_access" ON public."ai_models" FOR INSERT TO PUBLIC WITH CHECK (is_admin_user());
CREATE POLICY "ai_models_select_access" ON public."ai_models" FOR SELECT TO PUBLIC USING ((is_admin_user() OR true));
CREATE POLICY "ai_models_update_access" ON public."ai_models" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "announcements_admin_delete" ON public."announcements" FOR DELETE TO "authenticated" USING (( SELECT is_admin_user() AS is_admin_user));
CREATE POLICY "announcements_admin_insert" ON public."announcements" FOR INSERT TO "authenticated" WITH CHECK (( SELECT is_admin_user() AS is_admin_user));
CREATE POLICY "announcements_admin_select" ON public."announcements" FOR SELECT TO "authenticated" USING (( SELECT is_admin_user() AS is_admin_user));
CREATE POLICY "announcements_admin_update" ON public."announcements" FOR UPDATE TO "authenticated" USING (( SELECT is_admin_user() AS is_admin_user)) WITH CHECK (( SELECT is_admin_user() AS is_admin_user));
CREATE POLICY "annual_reports_delete_access" ON public."annual_reports" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "annual_reports_insert_access" ON public."annual_reports" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "annual_reports_select_access" ON public."annual_reports" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "annual_reports_update_access" ON public."annual_reports" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "app_settings_delete_access" ON public."app_settings" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.role() AS role) = 'service_role'::text)));
CREATE POLICY "app_settings_insert_access" ON public."app_settings" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.role() AS role) = 'service_role'::text)));
CREATE POLICY "app_settings_select_access" ON public."app_settings" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.role() AS role) = 'service_role'::text)));
CREATE POLICY "app_settings_update_access" ON public."app_settings" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.role() AS role) = 'service_role'::text))) WITH CHECK ((is_admin_user() OR (( SELECT auth.role() AS role) = 'service_role'::text)));
CREATE POLICY "archived_sources_delete_access" ON public."archived_sources" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "archived_sources_insert_access" ON public."archived_sources" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "archived_sources_select_access" ON public."archived_sources" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "archived_sources_update_access" ON public."archived_sources" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "Users can delete own bazi case events" ON public."bazi_case_events" FOR DELETE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can insert own bazi case events" ON public."bazi_case_events" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can update own bazi case events" ON public."bazi_case_events" FOR UPDATE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view own bazi case events" ON public."bazi_case_events" FOR SELECT TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can delete own bazi case profiles" ON public."bazi_case_profiles" FOR DELETE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can insert own bazi case profiles" ON public."bazi_case_profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can update own bazi case profiles" ON public."bazi_case_profiles" FOR UPDATE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view own bazi case profiles" ON public."bazi_case_profiles" FOR SELECT TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "bazi_charts_delete_access" ON public."bazi_charts" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "bazi_charts_insert_access" ON public."bazi_charts" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "bazi_charts_select_access" ON public."bazi_charts" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "bazi_charts_update_access" ON public."bazi_charts" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "community_comments_delete_access" ON public."community_comments" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "community_comments_insert_access" ON public."community_comments" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))));
CREATE POLICY "community_comments_select_access" ON public."community_comments" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (is_deleted = false)));
CREATE POLICY "community_comments_update_access" ON public."community_comments" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "community_posts_delete_access" ON public."community_posts" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "community_posts_insert_access" ON public."community_posts" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))));
CREATE POLICY "community_posts_select_access" ON public."community_posts" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (is_deleted = false)));
CREATE POLICY "community_posts_update_access" ON public."community_posts" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (is_deleted = true) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "community_reports_delete_access" ON public."community_reports" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "community_reports_insert_access" ON public."community_reports" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = reporter_id))));
CREATE POLICY "community_reports_select_access" ON public."community_reports" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = reporter_id)));
CREATE POLICY "community_reports_update_access" ON public."community_reports" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "community_votes_delete_access" ON public."community_votes" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "community_votes_insert_access" ON public."community_votes" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))));
CREATE POLICY "community_votes_select_access" ON public."community_votes" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "community_votes_update_access" ON public."community_votes" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "Users can delete own conversation messages" ON public."conversation_messages" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = conversation_messages.conversation_id) AND (conversations.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "Users can insert own conversation messages" ON public."conversation_messages" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = conversation_messages.conversation_id) AND (conversations.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "Users can update own conversation messages" ON public."conversation_messages" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = conversation_messages.conversation_id) AND (conversations.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = conversation_messages.conversation_id) AND (conversations.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "Users can view own conversation messages" ON public."conversation_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = conversation_messages.conversation_id) AND (conversations.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "conversations_delete_access" ON public."conversations" FOR DELETE TO "authenticated" USING ((( SELECT is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "conversations_insert_access" ON public."conversations" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "conversations_select_access" ON public."conversations" FOR SELECT TO "authenticated" USING ((( SELECT is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "conversations_update_access" ON public."conversations" FOR UPDATE TO "authenticated" USING ((( SELECT is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((( SELECT is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "credit_transactions_delete_access" ON public."credit_transactions" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "credit_transactions_insert_access" ON public."credit_transactions" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "credit_transactions_select_access" ON public."credit_transactions" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "credit_transactions_update_access" ON public."credit_transactions" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "daily_checkins_delete_access" ON public."daily_checkins" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "daily_checkins_insert_access" ON public."daily_checkins" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "daily_checkins_select_access" ON public."daily_checkins" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "daily_checkins_update_access" ON public."daily_checkins" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "Users can insert own daliuren divinations" ON public."daliuren_divinations" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can update own daliuren divinations" ON public."daliuren_divinations" FOR UPDATE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view own daliuren divinations" ON public."daliuren_divinations" FOR SELECT TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "face_readings_delete_access" ON public."face_readings" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "face_readings_insert_access" ON public."face_readings" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "face_readings_select_access" ON public."face_readings" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "face_readings_update_access" ON public."face_readings" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "hepan_charts_delete_access" ON public."hepan_charts" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "hepan_charts_insert_access" ON public."hepan_charts" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "hepan_charts_select_access" ON public."hepan_charts" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "hepan_charts_update_access" ON public."hepan_charts" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "knowledge_bases_delete_access" ON public."knowledge_bases" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "knowledge_bases_insert_access" ON public."knowledge_bases" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "knowledge_bases_select_access" ON public."knowledge_bases" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "knowledge_bases_update_access" ON public."knowledge_bases" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "knowledge_entries_delete_access" ON public."knowledge_entries" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (kb_id IN ( SELECT knowledge_bases.id
   FROM knowledge_bases
  WHERE (knowledge_bases.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "knowledge_entries_insert_access" ON public."knowledge_entries" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (kb_id IN ( SELECT knowledge_bases.id
   FROM knowledge_bases
  WHERE (knowledge_bases.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "knowledge_entries_select_access" ON public."knowledge_entries" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (kb_id IN ( SELECT knowledge_bases.id
   FROM knowledge_bases
  WHERE (knowledge_bases.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "knowledge_entries_update_access" ON public."knowledge_entries" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (kb_id IN ( SELECT knowledge_bases.id
   FROM knowledge_bases
  WHERE (knowledge_bases.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((is_admin_user() OR (kb_id IN ( SELECT knowledge_bases.id
   FROM knowledge_bases
  WHERE (knowledge_bases.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "liuyao_divinations_delete_access" ON public."liuyao_divinations" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "liuyao_divinations_insert_access" ON public."liuyao_divinations" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "liuyao_divinations_select_access" ON public."liuyao_divinations" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "liuyao_divinations_update_access" ON public."liuyao_divinations" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "mbti_readings_delete_access" ON public."mbti_readings" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "mbti_readings_insert_access" ON public."mbti_readings" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "mbti_readings_select_access" ON public."mbti_readings" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "mbti_readings_update_access" ON public."mbti_readings" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "Users can delete own meihua divinations" ON public."meihua_divinations" FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can insert own meihua divinations" ON public."meihua_divinations" FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can update own meihua divinations" ON public."meihua_divinations" FOR UPDATE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view own meihua divinations" ON public."meihua_divinations" FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "ming_notes_delete_access" ON public."ming_notes" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "ming_notes_insert_access" ON public."ming_notes" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "ming_notes_select_access" ON public."ming_notes" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "ming_notes_update_access" ON public."ming_notes" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "ming_records_delete_access" ON public."ming_records" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "ming_records_insert_access" ON public."ming_records" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "ming_records_select_access" ON public."ming_records" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "ming_records_update_access" ON public."ming_records" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "notifications_delete_admin_access" ON public."notifications" FOR DELETE TO "authenticated" USING (( SELECT is_admin_user() AS is_admin_user));
CREATE POLICY "notifications_insert_admin_access" ON public."notifications" FOR INSERT TO "authenticated" WITH CHECK (( SELECT is_admin_user() AS is_admin_user));
CREATE POLICY "notifications_select_access" ON public."notifications" FOR SELECT TO "authenticated" USING ((( SELECT is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "notifications_update_access" ON public."notifications" FOR UPDATE TO "authenticated" USING ((( SELECT is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((( SELECT is_admin_user() AS is_admin_user) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "palm_readings_delete_access" ON public."palm_readings" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "palm_readings_insert_access" ON public."palm_readings" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "palm_readings_select_access" ON public."palm_readings" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "palm_readings_update_access" ON public."palm_readings" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "Users can delete own qimen charts" ON public."qimen_charts" FOR DELETE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can insert own qimen charts" ON public."qimen_charts" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view own qimen charts" ON public."qimen_charts" FOR SELECT TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "reminder_subscriptions_delete_access" ON public."reminder_subscriptions" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "reminder_subscriptions_insert_access" ON public."reminder_subscriptions" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "reminder_subscriptions_select_access" ON public."reminder_subscriptions" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "reminder_subscriptions_update_access" ON public."reminder_subscriptions" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "scheduled_reminders_delete_access" ON public."scheduled_reminders" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "scheduled_reminders_insert_access" ON public."scheduled_reminders" FOR INSERT TO PUBLIC WITH CHECK (is_admin_user());
CREATE POLICY "scheduled_reminders_select_access" ON public."scheduled_reminders" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "scheduled_reminders_update_access" ON public."scheduled_reminders" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "tarot_readings_delete_access" ON public."tarot_readings" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "tarot_readings_insert_access" ON public."tarot_readings" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "tarot_readings_select_access" ON public."tarot_readings" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "tarot_readings_update_access" ON public."tarot_readings" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "user_oauth_providers_delete_access" ON public."user_oauth_providers" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "user_oauth_providers_insert_access" ON public."user_oauth_providers" FOR INSERT TO PUBLIC WITH CHECK (is_admin_user());
CREATE POLICY "user_oauth_providers_select_access" ON public."user_oauth_providers" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "user_oauth_providers_update_access" ON public."user_oauth_providers" FOR UPDATE TO PUBLIC USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "user_settings_delete_access" ON public."user_settings" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "user_settings_insert_access" ON public."user_settings" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "user_settings_select_access" ON public."user_settings" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "user_settings_update_access" ON public."user_settings" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "users_delete_access" ON public."users" FOR DELETE TO PUBLIC USING (is_admin_user());
CREATE POLICY "users_insert_access" ON public."users" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = id)));
CREATE POLICY "users_select_access" ON public."users" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = id)));
CREATE POLICY "users_update_access" ON public."users" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = id)));
CREATE POLICY "Users can delete own xiaoliuren divinations" ON public."xiaoliuren_divinations" FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can insert own xiaoliuren divinations" ON public."xiaoliuren_divinations" FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can update own xiaoliuren divinations" ON public."xiaoliuren_divinations" FOR UPDATE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view own xiaoliuren divinations" ON public."xiaoliuren_divinations" FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "ziwei_charts_delete_access" ON public."ziwei_charts" FOR DELETE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "ziwei_charts_insert_access" ON public."ziwei_charts" FOR INSERT TO PUBLIC WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "ziwei_charts_select_access" ON public."ziwei_charts" FOR SELECT TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "ziwei_charts_update_access" ON public."ziwei_charts" FOR UPDATE TO PUBLIC USING ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((is_admin_user() OR (( SELECT auth.uid() AS uid) = user_id)));
