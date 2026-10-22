import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Deliberately bounded SQL/RLS fixture, NOT a migration replay or a Supabase
// Auth/PostgREST emulator. Inputs remain repository-local and are never rewritten.
export const SQL_SOURCE_MANIFEST = {
  snapshot: 'supabase/tabel_export_from_supabase.sql',
  usersPolicies: 'supabase/migrations/fix_login_attempts_rls.sql',
  creditPolicies: 'supabase/migrations/20260118_create_gamification_tables.sql',
  conversationPolicies: 'supabase/migrations/create_conversations_table.sql',
  mbtiPolicies: 'supabase/migrations/20260110_add_mbti_readings_rls.sql',
  tarotPolicies: 'supabase/migrations/20260110_add_tarot_readings_rls.sql',
  knowledge: 'supabase/migrations/20260124_create_knowledge_base_tables.sql',
  archiveIds: 'supabase/migrations/20260125_alter_archived_sources_source_id_to_text.sql',
  search: 'supabase/migrations/20260124_search_functions.sql',
  extensions: 'supabase/migrations/20260126_fix_search_path_and_extensions.sql',
  admin: 'supabase/migrations/20260211_remove_service_role_key_phase2.sql',
  messages: 'supabase/migrations/20260316_create_conversation_messages.sql',
  transactions: 'supabase/migrations/20260408_z_remaining_transactional_multi_write_rpcs.sql',
  conversationAlignment: 'supabase/migrations/20260409_021500_admin_session_rpc_alignment.sql',
  graphDelete: 'supabase/selfhost/source-rpcs.sql',
  credits: 'supabase/migrations/20260409_235900_membership_credit_redesign.sql',
  creditAlignment: 'supabase/migrations/20260411_103500_align_admin_session_service_rpcs.sql',
  activationPolicies: 'supabase/migrations/20260123_add_activation_keys_and_purchase_links.sql',
  providers: 'supabase/migrations/20260313_user_oauth_providers.sql',
  authBinding: 'supabase/migrations/20260409_140500_full_atomicity_repairs.sql',
  claimConcurrency: 'supabase/migrations/20260410_103000_fix_linuxdo_claim_concurrency.sql',
  checkinOverflow: 'supabase/migrations/20260410_141500_checkin_overcap_drop_user_achievements.sql',
  history: 'supabase/migrations/20260723_100000_create_meihua_xiaoliuren_web.sql',
  searchCorrection: 'supabase/migrations/20261002_100000_fix_knowledge_search_contracts.sql',
  ledgerCorrection: 'supabase/migrations/20261002_101000_restrict_credit_ledger_rpc.sql',
  rateAdmission: 'supabase/migrations/20261003_100000_fix_rate_limit_admission.sql',
  accountProtection: 'supabase/migrations/20261002_102000_protect_account_and_ledger_writes.sql',
  agentRuntime: 'supabase/migrations/20261005_100000_agent_runtime.sql',
  agentDurable: 'supabase/migrations/20261006_100000_agent_pi_durable.sql',
  agentLifecycle: 'supabase/migrations/20261006_110000_agent_lifecycle_fixes.sql',
  agentChatResults: 'supabase/migrations/20261007_100000_agent_chat_results.sql',
  agentReading: 'supabase/migrations/20261007_110000_agent_reading_preferences.sql',
  agentSearch: 'supabase/migrations/20261007_120000_agent_search.sql',
  agentInput: 'supabase/migrations/20261007_130000_agent_input_preferences.sql',
  agentQueue: 'supabase/migrations/20261007_140000_agent_queue.sql',
  agentNotifications: 'supabase/migrations/20261007_150000_agent_notifications.sql',
  agentAttachments: 'supabase/migrations/20261007_160000_agent_attachments.sql',
  dailyBriefing: 'supabase/migrations/20261007_170000_daily_briefing.sql',
  conversationFork: 'supabase/migrations/20261007_180000_conversation_fork.sql',
  agentBackendAccess: 'supabase/migrations/20261007_190000_agent_backend_access.sql',
  agentQuestionDedupe: 'supabase/migrations/20261008_100000_agent_question_dedupe.sql',
  agentCompetence: 'supabase/migrations/20261008_180000_agent_competence.sql',
  agentDurableUpgrade: 'supabase/migrations/20261009_100000_agent_pi_durable_1_1.sql',
  reasoningEffortLevels: 'supabase/migrations/20261009_120000_ai_reasoning_effort_levels.sql',
  agentCurrentEngine: 'supabase/migrations/20261010_100000_agent_current_engine_only.sql',
  conversationShares: 'supabase/migrations/20261019_100000_conversation_shares.sql',
  agentDurable13: 'supabase/migrations/20261020_100000_agent_pi_durable_1_3.sql',
  agentUserSavedCharts: 'supabase/migrations/20261020_120000_agent_user_saved_charts.sql',
  agentAdminTaskLog: 'supabase/migrations/20261021_100000_agent_admin_task_log.sql',
  agentUserArchive: 'supabase/migrations/20261021_120000_agent_user_archive.sql',
  userSettings: 'supabase/migrations/20260110_add_user_settings_and_fix_notifications_rls.sql',
  chartTimeResolution: 'supabase/migrations/20261005_110000_chart_time_resolution.sql',
  agentChartIdentity: 'supabase/migrations/20261005_120000_agent_chart_identity.sql',
};

function requireMatch(matches, description) {
  if (matches.length !== 1) {
    throw new Error(`SQL fixture expected exactly one ${description}; found ${matches.length}. Review the source manifest.`);
  }
  return matches[0];
}

function functionDefinition(source, name) {
  return requireMatch(
    [...source.matchAll(new RegExp(`^CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*?^\\$\\$;`, 'gm'))].map(match => match[0]),
    `definition of ${name}`,
  );
}

function grants(source, names) {
  const statements = [...source.matchAll(/^(?:GRANT|REVOKE)\b[\s\S]*?;/gm)].map(match => match[0]);
  return names.map(name => {
    const selected = statements.filter(statement => statement.includes(`FUNCTION public.${name}(`));
    if (!selected.length) throw new Error(`Missing source grants for ${name}`);
    return selected.join('\n');
  }).join('\n');
}

function policies(source, table) {
  const selected = [...source.matchAll(/^CREATE POLICY\b[\s\S]*?;/gmi)]
    .map(match => match[0])
    .filter(statement => new RegExp(`\\bON (?:public\\.)?${table}\\b`, 'i').test(statement));
  if (!selected.length) throw new Error(`Missing source policies for ${table}`);
  return `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;\n${selected.join('\n')}`;
}

function before(source, marker) {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`Missing SQL fixture boundary: ${marker}`);
  return source.slice(0, at);
}

function from(source, marker) {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`Missing SQL fixture boundary: ${marker}`);
  return source.slice(at);
}

function snapshotTable(snapshot, name) {
  const definition = requireMatch(
    [...snapshot.matchAll(new RegExp(`^CREATE TABLE public\\.${name} \\([\\s\\S]*?^\\);`, 'gm'))].map(match => match[0]),
    `snapshot table ${name}`,
  );
  if (name !== 'conversations') return definition.replace(/\btags ARRAY\b/g, 'tags text[]');

  // The context-only snapshot renders an inline NOT VALID CHECK, which is not
  // executable CREATE TABLE syntax. Defer ONLY this constraint: the unchanged
  // July migration below installs its named CHECK ... NOT VALID before any data.
  // All selected foreign keys can be retained by creating auth/users first.
  const check = /^  source_type (.+) CHECK \(.+\) NOT VALID,$/m;
  if (!check.test(definition)) throw new Error('Review the snapshot conversation constraint fixture');
  return definition.replace(check, '  source_type $1,');
}

// Additional, bounded inputs for actual application adapters. No production
// metadata is read; table grants and the missing rate-limit index below remain
// explicit fixture assumptions until the authoritative export is supplied.
export const AUTH_SQL_SOURCE_MANIFEST = {
  userSettings: 'supabase/migrations/20260110_add_user_settings_and_fix_notifications_rls.sql',
  chartDetail: 'supabase/migrations/20260401_add_chart_prompt_detail_level_to_user_settings.sql',
  appSettings: 'supabase/migrations/20260113_add_app_settings.sql',
  modelPolicies: 'supabase/migrations/20260128_create_ai_model_tables.sql',
  gatewayPolicies: 'supabase/migrations/20260318_unify_ai_gateway_sources.sql',
};

export async function buildPostgresFixture(repoRoot, { authMode = 'synthetic' } = {}) {
  if (!['synthetic', 'gotrue'].includes(authMode)) throw new Error('Unknown SQL fixture auth mode');
  const realAuth = authMode === 'gotrue';
  const sources = {};
  const missing = [];
  const manifest = { ...SQL_SOURCE_MANIFEST, ...(realAuth ? AUTH_SQL_SOURCE_MANIFEST : {}) };
  for (const [key, filename] of Object.entries(manifest)) {
    try {
      sources[key] = await readFile(path.join(repoRoot, filename), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(filename);
    }
  }
  if (missing.length) {
    throw new Error(`Required repository SQL inputs are missing (do not skip this test). Review/allowlist these source files:\n${missing.join('\n')}`);
  }

  const creditRewrite = [...sources.creditAlignment.matchAll(/^DO \$\$[\s\S]*?^\$\$;/gm)][0]?.[0];
  if (!creditRewrite) throw new Error('Missing exact credit authorization amendment');
  const adminPolicies = requireMatch(
    [...sources.admin.matchAll(/^DO \$\$[\s\S]*?^END \$\$;/gm)].map(match => match[0]),
    'administrator policy block',
  );

  return [
    // Synthetic mode preserves the standalone SQL suite. GoTrue mode requires
    // migrations from the real Auth container and NEVER creates auth.users.
    // auth.uid/role are claim accessors, not identity resolvers: in GoTrue mode
    // only PostgREST's signature-validated request sets these claims.
    `CREATE ROLE taibu_contract_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS;
${realAuth ? `DO $$ BEGIN
  IF to_regclass('auth.users') IS NULL OR to_regclass('auth.identities') IS NULL OR to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'GoTrue must migrate its real auth schema before loading this fixture';
  END IF;
END $$;
GRANT USAGE ON SCHEMA auth TO taibu_contract_owner;
GRANT REFERENCES ON auth.users TO taibu_contract_owner;` : 'CREATE SCHEMA auth AUTHORIZATION taibu_contract_owner;'}
CREATE SCHEMA extensions;
CREATE EXTENSION vector WITH SCHEMA extensions;
CREATE EXTENSION pg_trgm WITH SCHEMA public;
CREATE EXTENSION pgcrypto WITH SCHEMA public;
GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role, taibu_contract_owner;
GRANT CREATE ON SCHEMA public TO taibu_contract_owner;
SET ROLE taibu_contract_owner;
SET search_path = public, extensions;
${realAuth ? '' : "CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);"}
${realAuth ? '' : `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '')
$$;`}`,
    // Five schema slices from the snapshot; no wholesale execution of it.
    ...['users', 'credit_transactions', 'conversations', 'mbti_readings', 'tarot_readings'].map(name => snapshotTable(sources.snapshot, name)),
    ...['bazi_charts', 'ziwei_charts', 'ming_records', 'bazi_case_profiles', 'bazi_case_events'].map(name => snapshotTable(sources.snapshot, name)),
    ...['user_settings', 'notifications', 'reminder_subscriptions'].map(name => snapshotTable(sources.snapshot, name)),
    policies(sources.userSettings, 'user_settings'),
    'ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY; CREATE POLICY fixture_notification_owner_read ON public.notifications FOR SELECT TO authenticated USING(user_id=auth.uid()); GRANT SELECT ON public.notifications TO authenticated;',
    'ALTER TABLE public.reminder_subscriptions ADD UNIQUE(user_id,reminder_type);',
    // Explicit bounded fixture owner policies for Agent chart/record reads.
    // The source-only selfhost baseline separately supplies its reviewed policy contract.
    ...['bazi_charts', 'ziwei_charts', 'ming_records', 'bazi_case_profiles', 'bazi_case_events'].map(name => `ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY; CREATE POLICY fixture_owner_read ON public.${name} FOR SELECT TO authenticated USING(user_id=auth.uid()); GRANT SELECT ON public.${name} TO authenticated;`),
    policies(sources.usersPolicies, 'users'),
    policies(sources.creditPolicies, 'credit_transactions'),
    policies(sources.conversationPolicies, 'conversations'),
    policies(sources.mbtiPolicies, 'mbti_readings'),
    policies(sources.tarotPolicies, 'tarot_readings'),
    snapshotTable(sources.snapshot, 'activation_keys'),
    policies(sources.activationPolicies, 'activation_keys'),
    // Retain the real daily uniqueness constraint, then the current removal of
    // streak_days; the context snapshot does not export this UNIQUE constraint.
    before(from(sources.creditPolicies, '-- 签到记录'), '-- 积分交易记录'),
    requireMatch([...sources.credits.matchAll(/^ALTER TABLE public\.daily_checkins[\s\S]*?;/gm)].map(match => match[0]), 'daily check-in amendment'),
    policies(sources.creditPolicies, 'daily_checkins'),
    sources.providers,
    snapshotTable(sources.snapshot, 'ai_models'),
    ...(realAuth ? [
      // Profile PATCH selects the full settings contract. Keep its existing
      // chart foreign keys; these two empty tables are only FK anchors here.
      sources.chartDetail,
      sources.appSettings,
      ...['ai_gateways', 'ai_model_gateway_bindings'].map(name => snapshotTable(sources.snapshot, name)),
      policies(sources.modelPolicies, 'ai_models'),
      policies(sources.gatewayPolicies, 'ai_gateways'),
      policies(sources.gatewayPolicies, 'ai_model_gateway_bindings'),
    ] : []),
    // Harness-only sequence/index prerequisites, not deployed-schema evidence.
    'CREATE SEQUENCE public.rate_limits_id_seq;',
    snapshotTable(sources.snapshot, 'rate_limits'),
    'CREATE UNIQUE INDEX ON public.rate_limits (identifier, endpoint);',
    // Keep real vector type, original uniqueness/indexes/RLS, then actual TEXT
    // source-id amendment. The snapshot's USER-DEFINED placeholder is not used.
    sources.knowledge,
    sources.archiveIds,
    functionDefinition(sources.admin, 'is_admin_user'),
    grants(sources.admin, ['is_admin_user']),
    // Preserve chronology: the February admin-policy block predates the March
    // messages table and July history tables; do not grant them invented policies.
    adminPolicies,
    sources.rateAdmission,
    ...(realAuth ? [
      // Explicit harness-only grants, constrained by the source RLS policies.
      'GRANT SELECT ON public.app_settings, public.ai_models, public.ai_gateways, public.ai_model_gateway_bindings, public.user_settings TO authenticated;',
    ] : []),
    // Empty fixture: no legacy message backfill is being claimed or exercised.
    before(sources.messages, 'INSERT INTO public.conversation_messages'),
    functionDefinition(sources.transactions, 'kb_replace_source_entries'),
    grants(sources.transactions, ['kb_replace_source_entries']),
    // Current owner-facing graph delete is exported separately from the older
    // administrator/service variant. Exercise the actual body and its grants.
    functionDefinition(sources.graphDelete, 'delete_conversation_graph'),
    grants(sources.graphDelete, ['delete_conversation_graph']),
    functionDefinition(sources.transactions, 'create_analysis_conversation_with_history_as_service'),
    grants(sources.transactions, ['create_analysis_conversation_with_history_as_service']),
    // The case notes save the archive migration replaces; the alignment below gives it the administrator guard first.
    functionDefinition(sources.transactions, 'save_bazi_case_profile_as_service'),
    grants(sources.transactions, ['save_bazi_case_profile_as_service']),
    // Whole narrowly scoped alignment: exact functions AND dynamic history guard
    // rewrite. Other listed functions are absent from this bounded fixture.
    sources.conversationAlignment,
    ...['membership_rank', 'membership_credit_limit', 'record_credit_transaction', 'decrement_ai_chat_count', 'increment_ai_chat_count', 'activate_key_as_service', 'handle_auth_user_profile_sync']
      .map(name => functionDefinition(sources.credits, name)),
    // April 10 replaces the original definitions; April 11 then restores
    // administrator-session admission on these exact current bodies.
    sources.claimConcurrency,
    functionDefinition(sources.checkinOverflow, 'perform_daily_checkin_as_service'),
    grants(sources.credits, ['record_credit_transaction']),
    creditRewrite,
    grants(sources.creditAlignment, ['record_credit_transaction', 'decrement_ai_chat_count', 'increment_ai_chat_count', 'activate_key_as_service', 'perform_daily_checkin_as_service', 'claim_linuxdo_membership_as_service']),
    // Attach the active production Auth sync before any test users are created.
    // GoTrue owns auth.users; only trigger DDL needs bootstrap privileges.
    'RESET ROLE;',
    before(from(sources.authBinding, 'DROP TRIGGER IF EXISTS on_auth_user_created_profile'), 'REVOKE ALL ON FUNCTION public.schedule_reminder_if_absent_as_service'),
    'SET ROLE taibu_contract_owner;',
    // Preserve extension placement, even when it exposes RPC search_path defects.
    'RESET ROLE;',
    from(sources.extensions, '-- Move pg_trgm out of public schema'),
    'SET ROLE taibu_contract_owner;',
    sources.search,
    // Exclude unrelated history deletion RPC, retain table definitions, current
    // checks, exact legacy rename/wrapper, and all wrapper grants/revocations.
    before(sources.history, '-- Extend authenticated history deletion'),
    from(sources.history, '-- Preserve all existing history creation behavior'),
    // Reviewed broad account/ledger privileges are intentional: security tests
    // must fail because of the guard/RLS, never because table grants are absent.
    // Other tables remain bounded fixtures, not a deployment metadata replay.
    `GRANT SELECT, INSERT, UPDATE, DELETE ON public.users, public.credit_transactions TO anon, authenticated;
GRANT ALL ON public.users, public.credit_transactions TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO anon, service_role;
GRANT SELECT ON public.activation_keys, public.daily_checkins, public.user_oauth_providers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations, public.conversation_messages,
  public.mbti_readings, public.tarot_readings, public.knowledge_bases, public.knowledge_entries, public.archived_sources TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
RESET ROLE;`,
    // Separately reviewed corrective migrations run last and verbatim. Historic
    // definitions, authorization amendments and extension placement stay intact.
    sources.searchCorrection,
    sources.ledgerCorrection,
    sources.accountProtection,
    'SET ROLE taibu_contract_owner;',
    sources.agentRuntime,
    sources.chartTimeResolution,
    sources.agentChartIdentity,
    sources.agentDurable,
    sources.agentLifecycle,
    sources.agentChatResults,
    sources.agentReading,
    sources.agentSearch,
    sources.agentInput,
    sources.agentQueue,
    sources.agentNotifications,
    sources.agentAttachments,
    sources.dailyBriefing,
    sources.conversationFork,
    sources.agentBackendAccess,
    sources.agentQuestionDedupe,
    sources.agentCompetence,
    sources.agentDurableUpgrade,
    sources.reasoningEffortLevels,
    sources.agentCurrentEngine,
    sources.conversationShares,
    sources.agentDurable13,
    sources.agentUserSavedCharts,
    sources.agentAdminTaskLog,
    sources.agentUserArchive,
    'RESET ROLE;',
  ].join('\n\n');
}
