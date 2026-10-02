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
  credits: 'supabase/migrations/20260409_235900_membership_credit_redesign.sql',
  creditAlignment: 'supabase/migrations/20260411_103500_align_admin_session_service_rpcs.sql',
  history: 'supabase/migrations/20260723_100000_create_meihua_xiaoliuren_web.sql',
  searchCorrection: 'supabase/migrations/20261002_100000_fix_knowledge_search_contracts.sql',
  ledgerCorrection: 'supabase/migrations/20261002_101000_restrict_credit_ledger_rpc.sql',
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
  if (name !== 'conversations') return definition;

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
  rateRpc: 'supabase/migrations/20260409_000100_remaining_atomicity_rpcs.sql',
  rateAcl: 'supabase/migrations/20260411_111500_restrict_admin_session_rpc_acl.sql',
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
${realAuth ? '' : 'CREATE TABLE auth.users (id uuid PRIMARY KEY);'}
${realAuth ? '' : `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '')
$$;`}`,
    // Five schema slices from the snapshot; no wholesale execution of it.
    ...['users', 'credit_transactions', 'conversations', 'mbti_readings', 'tarot_readings'].map(name => snapshotTable(sources.snapshot, name)),
    policies(sources.usersPolicies, 'users'),
    policies(sources.creditPolicies, 'credit_transactions'),
    policies(sources.conversationPolicies, 'conversations'),
    policies(sources.mbtiPolicies, 'mbti_readings'),
    policies(sources.tarotPolicies, 'tarot_readings'),
    ...(realAuth ? [
      before(sources.userSettings, '-- Only server-side code'),
      sources.chartDetail,
      sources.appSettings,
      ...['ai_models', 'ai_gateways', 'ai_model_gateway_bindings'].map(name => snapshotTable(sources.snapshot, name)),
      policies(sources.modelPolicies, 'ai_models'),
      policies(sources.gatewayPolicies, 'ai_gateways'),
      policies(sources.gatewayPolicies, 'ai_model_gateway_bindings'),
      // Snapshot omits sequences/indexes. This harness-only prerequisite lets
      // the real ON CONFLICT RPC execute; it is NOT deployed-schema evidence.
      'CREATE SEQUENCE public.rate_limits_id_seq;',
      snapshotTable(sources.snapshot, 'rate_limits'),
      'CREATE UNIQUE INDEX ON public.rate_limits (identifier, endpoint);',
    ] : []),
    // Keep real vector type, original uniqueness/indexes/RLS, then actual TEXT
    // source-id amendment. The snapshot's USER-DEFINED placeholder is not used.
    sources.knowledge,
    sources.archiveIds,
    functionDefinition(sources.admin, 'is_admin_user'),
    grants(sources.admin, ['is_admin_user']),
    // Preserve chronology: the February admin-policy block predates the March
    // messages table and July history tables; do not grant them invented policies.
    adminPolicies,
    ...(realAuth ? [
      functionDefinition(sources.rateRpc, 'consume_rate_limit_slot_as_admin'),
      grants(sources.rateAcl, ['consume_rate_limit_slot_as_admin']),
      // Explicit harness-only grants, constrained by the source RLS policies.
      'GRANT SELECT ON public.app_settings, public.ai_models, public.ai_gateways, public.ai_model_gateway_bindings, public.user_settings TO authenticated;',
    ] : []),
    // Empty fixture: no legacy message backfill is being claimed or exercised.
    before(sources.messages, 'INSERT INTO public.conversation_messages'),
    functionDefinition(sources.transactions, 'kb_replace_source_entries'),
    grants(sources.transactions, ['kb_replace_source_entries']),
    functionDefinition(sources.transactions, 'create_analysis_conversation_with_history_as_service'),
    grants(sources.transactions, ['create_analysis_conversation_with_history_as_service']),
    // Whole narrowly scoped alignment: exact functions AND dynamic history guard
    // rewrite. Other listed functions are absent from this bounded fixture.
    sources.conversationAlignment,
    ...['record_credit_transaction', 'decrement_ai_chat_count', 'increment_ai_chat_count']
      .map(name => functionDefinition(sources.credits, name)),
    grants(sources.credits, ['record_credit_transaction']),
    creditRewrite,
    grants(sources.creditAlignment, ['record_credit_transaction', 'decrement_ai_chat_count', 'increment_ai_chat_count']),
    // Preserve extension placement, even when it exposes RPC search_path defects.
    'RESET ROLE;',
    from(sources.extensions, '-- Move pg_trgm out of public schema'),
    'SET ROLE taibu_contract_owner;',
    sources.search,
    // Exclude unrelated history deletion RPC, retain table definitions, current
    // checks, exact legacy rename/wrapper, and all wrapper grants/revocations.
    before(sources.history, '-- Extend authenticated history deletion'),
    from(sources.history, '-- Preserve all existing history creation behavior'),
    // Explicit harness-only table grants model the exercised entry points. Their
    // deployed equivalence/default privileges are intentionally not asserted.
    `GRANT SELECT ON public.users, public.credit_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations, public.conversation_messages,
  public.mbti_readings, public.tarot_readings, public.knowledge_bases, public.knowledge_entries, public.archived_sources TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
RESET ROLE;`,
    // Separately reviewed corrective migrations run last and verbatim. Historic
    // definitions, authorization amendments and extension placement stay intact.
    sources.searchCorrection,
    sources.ledgerCorrection,
  ].join('\n\n');
}
