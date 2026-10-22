import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/selfhost/001-application.sql');
const storage = read('supabase/selfhost/002-storage.sql');
const manifest = JSON.parse(read('supabase/selfhost/manifest.json'));
const names = text => [...text.matchAll(/^CREATE TABLE public\.(\w+) /gm)].map(m => m[1]).sort();
const definition = name => [...sql.matchAll(new RegExp(`^CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*?^\\$\\$[^;]*;`, 'gm'))].at(-1)?.[0];

test('generated artifacts and caller inventory are deterministic and source-pinned', () => {
  execFileSync(process.execPath, ['scripts/selfhost-schema.mjs'], { cwd: root });
  for (const entry of [...manifest.sources, ...manifest.artifacts]) {
    assert.equal(createHash('sha256').update(read(entry.file)).digest('hex'), entry.sha256, entry.file);
  }
  assert.equal(manifest.baselineRevision, '5725dde');
  assert.ok(manifest.sources.length >= 20);
  assert.match(sql, new RegExp(`COMMENT ON SCHEMA public IS 'taibu-selfhost-v1:${manifest.sourceFingerprint}'`));
});

test('all 55 application tables retain the reviewed snapshot column inventory', () => {
  const snapshot = read('supabase/tabel_export_from_supabase.sql');
  assert.equal(names(sql).length, 55);
  assert.deepEqual(names(sql), names(snapshot));
  for (const match of snapshot.matchAll(/^CREATE TABLE public\.(\w+) \(([\s\S]*?)^\);/gm)) {
    const actual = new RegExp(`CREATE TABLE public\\.${match[1]} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1];
    assert.ok(actual, match[1]);
    for (const column of match[2].matchAll(/^  ([a-z_]+) /gm)) {
      if (match[1] === 'agent_workers' && column[1] === 'engine')
        assert.match(sql, /ALTER TABLE public.agent_workers ADD COLUMN engine text NOT NULL/);
      else if (match[1] === 'agent_run_commands' && column[1] === 'durable_admitted')
        assert.match(sql, /ALTER TABLE public.agent_run_commands ADD COLUMN durable_admitted boolean NOT NULL/);
      else if (match[1] === 'agent_run_commands' && ['revision','sort_order','delivery_state','original_message','original_mode'].includes(column[1])) assert.match(sql,new RegExp(`ADD COLUMN ${column[1]} `));
      else assert.match(actual, new RegExp(`^\\s+${column[1]} `, 'm'));
    }
  }
  assert.doesNotMatch(sql, /\bUSER-DEFINED\b|\b(?:tags|yongshen_targets) ARRAY\b|\) NOT VALID,/);
  assert.match(sql, /content_vector extensions\.vector/);
  const agentStart=sql.indexOf('CREATE TABLE public.agent_runs');
  assert.ok(sql.slice(0,agentStart).lastIndexOf('CREATE TABLE public.') < sql.indexOf('ADD CONSTRAINT activation_keys_'));
  assert.ok(agentStart>sql.indexOf('ADD CONSTRAINT activation_keys_'));
});

test('platform tables are never fabricated and transaction ownership belongs to caller', () => {
  assert.match(sql, /GoTrue must initialize the real auth schema first/);
  assert.match(sql, /application baseline requires an empty public schema/);
  assert.doesNotMatch(sql, /^CREATE (?:TABLE|SCHEMA|ROLE) (?:auth|storage|anon|authenticated)/gmi);
  assert.doesNotMatch(sql, /^BEGIN;|^COMMIT;/gm);
  assert.doesNotMatch(storage, /^BEGIN;|^COMMIT;|CREATE TABLE/gm);
  assert.match(sql, /current_setting\('request.jwt.claims', true\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION auth.uid\(\), auth.role\(\) FROM PUBLIC/);
});

test('RLS covers every table; community remains closed instead of inventing counters', () => {
  for (const name of names(sql)) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${name} ENABLE ROW LEVEL SECURITY;`));
    assert.match(sql, new RegExp(`REVOKE ALL ON TABLE public\\.${name} FROM PUBLIC, anon, authenticated;`));
  }
  for (const name of ['community_posts', 'community_comments', 'community_votes', 'community_reports']) {
    assert.doesNotMatch(sql, new RegExp(`CREATE POLICY .* ON public\\.${name} `));
  }
  assert.match(sql, /WITH CHECK \(user_id = \(SELECT auth.uid\(\)\)/);
  assert.match(sql, /kb.id = archived_sources.kb_id AND kb.user_id = \(SELECT auth.uid\(\)\)/);
  assert.match(sql, /b.id = default_bazi_chart_id AND b.user_id = \(SELECT auth.uid\(\)\)/);
  assert.match(sql, /c.id = tarot_readings.conversation_id AND c.user_id = \(SELECT auth.uid\(\)\)/);
});

test('administrator JWT and entitlement/ledger write boundaries remain intact', () => {
  assert.match(definition('is_admin_user'), /u.id = auth.uid\(\) AND u.is_admin = true/);
  assert.match(sql, /CREATE TRIGGER guard_user_entitlement_writes/);
  assert.match(sql, /credit_transactions_authenticated_insert_guard/);
  assert.match(sql, /AS RESTRICTIVE/);
  assert.match(sql, /current_user = v_owner OR current_user = 'service_role'/);
  const ledgerRestriction = sql.lastIndexOf('REVOKE ALL ON FUNCTION public.record_credit_transaction');
  assert.ok(ledgerRestriction > sql.indexOf('CREATE TRIGGER on_auth_user_profile_synced'));
  assert.match(sql.slice(ledgerRestriction), /FROM PUBLIC, anon, authenticated/);
  assert.match(definition('handle_auth_user_profile_sync'), /'free',\s*1/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON ALL FUNCTIONS/);
});

test('restored transactional uniqueness and message cascade are present', () => {
  for (const key of ['daily_checkins', 'reminder_subscriptions', 'annual_reports', 'archived_sources', 'knowledge_entries', 'user_oauth_providers', 'ai_model_gateway_bindings', 'scheduled_reminders']) {
    assert.match(sql, new RegExp(`CONSTRAINT selfhost_${key}_unique UNIQUE`));
  }
  assert.match(sql, /conversation_messages_conversation_id_fkey FOREIGN KEY \(conversation_id\) REFERENCES public.conversations\(id\) ON DELETE CASCADE/);
  assert.match(sql, /conversation_messages_conversation_sequence_idx/);
  assert.match(sql, /CONSTRAINT vector_metadata_check CHECK/);
  assert.match(sql, /RENAME TO create_analysis_conversation_with_history_legacy_as_service/);
});

test('all current literal application RPC references have definitions or explicit blockers', () => {
  // P4 moved rate limiting fully to Redis; consume_rate_limit_slot_as_admin lost its last caller.
  assert.equal(manifest.rpcReferences.length, 62);
  assert.deepEqual(manifest.rpcReferences.filter(r => r.status === 'missing-source'), []);
  for (const rpc of manifest.rpcReferences) assert.ok(definition(rpc.name) || ['check_login_attempts', 'record_login_attempt'].includes(rpc.name), rpc.name);
  assert.deepEqual(manifest.requiredPostBaselineMigrations, ['supabase/migrations/20261003_100000_fix_rate_limit_admission.sql']);
  assert.equal(manifest.blockedFunctions.consume_rate_limit_slot_as_admin.startsWith('Disabled until'), true);
});

test('local graph deletion and vector compatibility repairs preserve tenant isolation', () => {
  assert.match(definition('delete_conversation_graph'), /USING public.knowledge_bases kb\s+WHERE e.kb_id = kb.id AND kb.user_id = v_user_id/);
  for (const name of ['batch_update_vectors', 'batch_update_vectors_as_service']) {
    const body = definition(name);
    assert.doesNotMatch(body, /isfinite\(/);
    assert.match(body, /x IS NULL OR x IN \('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8\)/);
    assert.ok(body.includes("v_elem_text !~ '^-?[0-9]+[.]?[0-9]*([eE][+-]?[0-9]+)?$'"));
    assert.match(body, /kb.user_id = (?:v|p)_user_id/);
  }
});

test('Agent lifecycle repair is included after Durable without adding tables or changing settlement', () => {
  const migration = 'supabase/migrations/20261006_110000_agent_lifecycle_fixes.sql';
  assert.ok(manifest.sources.some(source => source.file === migration));
  assert.match(definition('agent_create_run'), /versions:=jsonb_set\(versions,ARRAY\[version_index::text\],version_snapshot\)/);
  assert.match(definition('agent_protect_conversation_delete'), /status IN \('queued','running','awaiting_input','cancelling'\)/);
  assert.match(sql, /CREATE TRIGGER agent_conversation_delete_guard BEFORE DELETE ON public.conversations/);
  assert.ok(sql.indexOf('CREATE TRIGGER agent_conversation_delete_guard') > sql.indexOf('CREATE TABLE public.agent_durable_commits'));
  // The Durable migration amends the catalog body with pg_get_functiondef;
  // the generated source's last literal definition precedes that amendment.
  assert.match(sql, /new_guard text := .*durable_admitted/);
  assert.equal(names(sql).length, 55);
});

test('public conversation shares install from their migration with owner-only reads and token-only anonymous access', () => {
  const migration = 'supabase/migrations/20261019_100000_conversation_shares.sql';
  assert.ok(manifest.sources.some(source => source.file === migration));
  assert.equal(manifest.tables.find(table => table.name === 'conversation_shares')?.security.startsWith('Feature migration'), true);
  assert.match(sql, /CREATE POLICY conversation_shares_owner_select ON public.conversation_shares FOR SELECT TO authenticated USING \(user_id = \(SELECT auth.uid\(\)\)\);/);
  assert.match(sql, /GRANT SELECT ON public.conversation_shares TO authenticated;/);
  assert.doesNotMatch(sql, /GRANT (?:ALL|INSERT|UPDATE|DELETE)[^;]*ON (?:TABLE )?public.conversation_shares/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public.get_conversation_share\(text\) TO anon, authenticated;/);
  for (const name of ['upsert_conversation_share', 'revoke_conversation_share']) {
    assert.match(definition(name), /SECURITY DEFINER SET search_path=public,pg_temp/);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM public,anon;`));
  }
  for (const name of ['get_conversation_share', 'upsert_conversation_share', 'revoke_conversation_share']) {
    assert.equal(manifest.rpcReferences.find(reference => reference.name === name)?.status, 'defined', name);
  }
});

test('storage uses actual flat UID naming, bounded MIME/size and owner-only writes', () => {
  assert.match(storage, /2097152/);
  assert.match(storage, /name LIKE \(SELECT auth.uid\(\)\)::text \|\| '-%'/);
  assert.doesNotMatch(storage, /image\/svg\+xml|FOR (?:INSERT|UPDATE|DELETE) TO anon/);
  assert.match(storage, /Storage must migrate its real schema/);
  assert.match(storage, /CREATE POLICY selfhost_avatar_update/);
  assert.match(storage, /position\('\.\.' IN name\) = 0/);
});

test('archive views execute as caller and expose SELECT only', () => {
  assert.deepEqual(manifest.views.map(v => v.name).sort(), ['conversations_with_archive_status', 'ming_records_with_archive_status']);
  for (const view of manifest.views) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE VIEW public\\.${view.name} AS`));
    assert.match(sql, new RegExp(`ALTER VIEW public\\.${view.name} SET \\(security_invoker = on\\);`));
  }
  const views = read('supabase/selfhost/source-views.sql');
  assert.equal((views.match(/AND a.user_id = c.user_id/g) ?? []).length, 2);
  assert.match(views, /REVOKE ALL ON public.conversations_with_archive_status, public.ming_records_with_archive_status\s+FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(views, /GRANT SELECT ON public.conversations_with_archive_status, public.ming_records_with_archive_status\s+TO authenticated, service_role/);
  assert.doesNotMatch(views, /GRANT (?:ALL|INSERT|UPDATE|DELETE)/);
});

test('literal relations and dynamic factory catalogs resolve to real tables or views', () => {
  const relations = new Map(manifest.relationReferences.map(r => [r.name, r]));
  for (const relation of relations.values()) assert.ok(names(sql).includes(relation.name) || manifest.views.some(v => v.name === relation.name), relation.name);
  assert.ok(manifest.views.some(v => v.name === 'conversations_with_archive_status'));
  assert.ok(relations.get('ming_records_with_archive_status').callers.some(c => c.file === 'src/app/api/records/route.ts'));
  assert.ok(relations.get('tarot_readings').callers.some(c => c.file === 'src/lib/history/registry.ts' && c.kind === 'tableName-catalog'));
  assert.ok(relations.get('bazi_charts').callers.some(c => c.kind === 'chart-return-catalog'));
  // The former typed Supabase adapter for users is gone; scoped Kysely is now
  // the only path that resolves the users relation for community authors.
  assert.ok(relations.get('users').callers.some(c => c.kind === 'literal-kysely'));
  assert.ok(manifest.dynamicRelationSites.some(s => s.file === 'src/lib/api/divination-pipeline.ts' && s.expression === 'tableName'));
  assert.ok(manifest.dynamicRelationSites.some(s => s.file === 'src/lib/api/chart-crud.ts' && s.expression === 'config.tableName'));
  assert.deepEqual(manifest.excludedRelationAdapters, []);
  assert.equal(relations.has('avatars'), false);
});
