// Applies the current SQL definitions in a disposable PostgreSQL 17
// container and asserts the baseline invariants that the application relies on.
// Run: node --test scripts/tests/db-init.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeSchemaDump } from '../db/normalize-schema.mjs';
import { execute } from '../selfhost.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const image = 'pgvector/pgvector:0.8.7-pg17-bookworm';
const runLabel = 'io.taibu.db-baseline.run';
const database = 'taibu_baseline';
const reference = 'taibu_reference';

function docker(args, { input = '', timeout = 60_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`docker ${args[0]} failed: ${(stderr || error.message).trim()}`));
        else resolve(stdout.trim());
      });
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin.end(input);
  });
}

async function assertLocalDocker() {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
    ? process.env.DOCKER_HOST
    : await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  assert.ok(endpoint.startsWith('unix://'), 'these tests require a local Unix-socket Docker endpoint');
  await docker(['version', '--format', '{{.Server.Version}}']);
}

test('current SQL initializes and refreshes the native database', { timeout: 300_000 }, async (t) => {
  await assertLocalDocker();
  const runId = randomUUID();
  const containerName = `taibu-baseline-${runId}`;
  const postgresPassword = randomBytes(32).toString('hex');
  const appPassword = randomBytes(32).toString('hex');
  const schemaPassword = randomBytes(32).toString('hex');
  let containerId;

  const cleanup = async () => {
    if (!containerId) return;
    const label = await docker(['inspect', '--format', `{{ index .Config.Labels "${runLabel}" }}`, containerId]).catch(() => '');
    if (label !== runId) return;
    await docker(['rm', '--force', '--volumes', containerId]).catch(() => {});
  };

  try {
    containerId = await docker([
      'create', '--name', containerName, '--label', `${runLabel}=${runId}`,
      '--publish', '127.0.0.1::5432',
      '--tmpfs', '/var/lib/postgresql/data:rw',
      '--env', 'POSTGRES_PASSWORD', '--env', `POSTGRES_DB=${database}`,
      image, 'postgres',
    ], { env: { ...process.env, POSTGRES_PASSWORD: postgresPassword } });
    await docker(['start', containerId]);

    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        await docker(['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', database], { timeout: 3_000 });
        ready = true;
        break;
      } catch { await delay(500); }
    }
    assert.ok(ready, 'PostgreSQL container did not become ready');
    // initdb starts a temporary server; pg_isready can succeed before the final
    // server accepts connections, so prove it with a real query.
    let accepting = false;
    while (Date.now() < deadline) {
      try {
        await docker(['exec', containerId, 'psql', '-X', '-q', '-h', '127.0.0.1', '-U', 'postgres', '-d', database, '-c', 'select 1'], { timeout: 3_000 });
        accepting = true;
        break;
      } catch { await delay(500); }
    }
    assert.ok(accepting, 'PostgreSQL did not accept queries after initdb');

    const sql = (statement, target = database) => docker([
      'exec', '-i', containerId, 'psql', '-X', '--quiet', '--tuples-only', '--no-align',
      '--set', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', target,
    ], { input: statement });

    const bootstrapSql = await readFile(path.join(repoRoot, 'database/bootstrap/00-roles.sql'), 'utf8');
    await sql(`${bootstrapSql}
ALTER DATABASE ${database} SET timezone = 'UTC';
REVOKE ALL ON DATABASE ${database} FROM PUBLIC;
GRANT CREATE, CONNECT ON DATABASE ${database} TO taibu_owner;
GRANT CONNECT ON DATABASE ${database} TO taibu_schema, taibu_app, taibu_auth, taibu_backup;
ALTER ROLE taibu_app PASSWORD '${appPassword}';
ALTER ROLE taibu_schema PASSWORD '${schemaPassword}';`);

    const hostPort = Number((await docker(['port', containerId, '5432/tcp'])).split(':').at(-1));
    const adminUrl = (name) => `postgres://postgres:${postgresPassword}@127.0.0.1:${hostPort}/${name}`;
    const native = new pg.Client({ host: '127.0.0.1', port: hostPort, user: 'postgres', password: postgresPassword, database });
    await native.connect();
    const initialize = (target = database, args = []) => new Promise((resolve, reject) => execFile(process.execPath, ['scripts/db/init.mjs', ...args], {
      cwd: repoRoot, timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, SCHEMA_DATABASE_URL: `postgres://taibu_schema:${schemaPassword}@127.0.0.1:${hostPort}/${target}` },
    }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
    // Structure and privileges of every managed schema, in pg_dump's canonical text.
    const definitionsOf = async (target) => normalizeSchemaDump(await docker(['exec', containerId, 'pg_dump', '-U', 'postgres',
      '-d', target, '--schema-only', '-n', 'public', '-n', 'identity', '-n', 'auth', '-n', 'extensions']));
    try {
      await t.test('bootstrap validates all passwords and rolls back changes if database setup fails', async () => {
        const state = async () => createHash('sha256').update(JSON.stringify((await native.query("select rolname, rolpassword, rolinherit, rolcreaterole, rolsuper, rolbypassrls from pg_authid where rolname like 'taibu_%' order by rolname")).rows)).digest('hex');
        const before = await state();
        const environment = { ...process.env, ADMIN_DATABASE_URL: adminUrl(database),
          TAIBU_SCHEMA_PASSWORD: randomBytes(32).toString('hex'), TAIBU_APP_PASSWORD: randomBytes(32).toString('hex'),
          TAIBU_AUTH_PASSWORD: randomBytes(32).toString('hex'), TAIBU_BACKUP_PASSWORD: '' };
        const bootstrap = env => new Promise((resolve, reject) => execFile(process.execPath, [path.join(repoRoot, 'scripts/db/bootstrap.mjs')],
          { env, timeout: 30_000 }, (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(stdout)));
        await assert.rejects(bootstrap(environment), /TAIBU_BACKUP_PASSWORD is required/);
        assert.equal(await state(), before, 'missing passwords must not partially rotate role credentials');
        await assert.rejects(bootstrap({
          ...environment, TAIBU_BACKUP_PASSWORD: randomBytes(32).toString('hex'), TAIBU_DB_NAME: 'review_missing_database',
        }), /does not exist/);
        assert.equal(await state(), before, 'database setup failure must roll back role changes');
      });
      await t.test('restore verification preserves existing databases and cleans up its failed restore', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'taibu-restore-contract-'));
        const backup = path.join(directory, 'invalid.dump');
        const existing = 'taibu_restore_existing_fixture';
        const owned = 'taibu_restore_failed_fixture';
        await writeFile(backup, 'invalid backup');
        await native.query(`create database ${existing}`);
        try {
          const verify = name => execute(process.execPath, ['scripts/db/verify-restore.mjs', '--backup', backup, '--database', name,
            '--report', path.join(directory, 'report.json')], { cwd: repoRoot, env: { ...process.env, RESTORE_ADMIN_URL: adminUrl(database) } });
          await assert.rejects(verify(existing), /already exists/);
          assert.equal((await native.query('select count(*)::int as n from pg_database where datname=$1', [existing])).rows[0].n, 1);
          await assert.rejects(verify(database), /temporary database named/);
          await assert.rejects(verify(owned), /pg_restore failed/);
          assert.equal((await native.query('select count(*)::int as n from pg_database where datname=$1', [owned])).rows[0].n, 0);
          assert.equal(JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8')).databaseDropped, true);
        } finally {
          await native.query(`drop database if exists ${existing} with (force)`);
          await native.query(`drop database if exists ${owned} with (force)`);
          await rm(directory, { recursive: true, force: true });
        }
      });
      await t.test('concurrent initialization is serialized and baselines the migration ledger', async () => {
        const logs = await Promise.all([initialize(), initialize()]);
        assert.equal(logs.filter(log => log.includes('[db:init] initialized')).length, 1);
        assert.equal(logs.filter(log => log.includes('[db:init] refreshed current SQL definitions (no definition changes)')).length, 1);
        const ledger = await native.query("select version, baseline from taibu_meta.schema_migrations order by version");
        assert.ok(ledger.rows.length > 0, 'a fresh database records every migration as a baseline');
        assert.ok(ledger.rows.every(row => row.baseline), 'first-time rows are baselines, not executions');
        assert.match(await initialize(), /No pending migrations/);
      });
      await t.test('a refresh with nothing to change commits no catalog change', async () => {
        const catalog = async () => (await native.query(`select md5(string_agg(x, ',' order by x)) as hash from (
          select oid::text || ':' || xmin::text as x from pg_class union all select oid::text || ':' || xmin::text from pg_proc
          union all select oid::text || ':' || xmin::text from pg_policy union all select oid::text || ':' || xmin::text from pg_trigger) rows`)).rows[0].hash;
        const before = await catalog();
        assert.match(await initialize(), /\(no definition changes\)/);
        assert.equal(await catalog(), before);
      });
      await t.test('refresh preserves business rows and converges stale, altered and missing definitions', async () => {
        await native.query("insert into identity.users(id,email,name) values ('00000000-0000-4000-8000-0000000000ef','retained@fixture.test','保留用户')");
        await native.query(`
          SET ROLE taibu_owner;
          GRANT UPDATE ON public.notifications TO authenticated;
          GRANT SELECT ON public.users TO PUBLIC;
          GRANT USAGE ON SCHEMA public TO PUBLIC;
          CREATE POLICY review_stale_policy ON public.notifications FOR SELECT USING (true);
          DROP POLICY app_settings_select_access ON public.app_settings;
          CREATE POLICY app_settings_select_access ON public.app_settings FOR SELECT USING (true);
          ALTER TABLE public.ming_notes DISABLE ROW LEVEL SECURITY;
          CREATE FUNCTION public.review_stale_function() RETURNS integer LANGUAGE sql AS 'select 1';
          GRANT EXECUTE ON FUNCTION public.review_stale_function() TO anon;
          CREATE OR REPLACE FUNCTION public.agent_archive_entry_id(p_run_id uuid, p_call_id text) RETURNS uuid
            LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS 'SELECT gen_random_uuid()';
          CREATE VIEW public.review_stale_view AS SELECT 1 AS one;
          CREATE TRIGGER review_stale_trigger BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.update_conversations_updated_at();
          DROP TRIGGER agent_notify_event ON public.agent_run_events;
          ALTER TABLE public.agent_runs DISABLE TRIGGER agent_notify_run;
          DROP INDEX public.agent_events_cursor;
          CREATE INDEX agent_events_cursor ON public.agent_run_events USING btree (sequence);
          CREATE INDEX review_stale_index ON public.notifications USING btree (created_at);
          RESET ROLE;
          UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.agent_claim_queued'::regclass;`);
        const log = await initialize();
        assert.match(log, /dropping functions no longer declared: public\.review_stale_function\(\)/);
        assert.match(log, /dropping views no longer declared: public\.review_stale_view/);
        assert.match(log, /indexes 1 created, 1 rebuilt, 1 dropped/);
        assert.equal((await native.query("select name from identity.users where email='retained@fixture.test'")).rows[0].name, '保留用户');
        await sql(`CREATE DATABASE ${reference}`);
        await execute(process.execPath, ['scripts/db/bootstrap.mjs', '--no-passwords'], { cwd: repoRoot, env: { ...process.env, ADMIN_DATABASE_URL: adminUrl(reference) } });
        assert.match(await initialize(reference), /\[db:init\] initialized/);
        assert.equal(await definitionsOf(database), await definitionsOf(reference), 'a refreshed database must equal a fresh one');
        assert.match(await initialize(), /\(no definition changes\)/);
      });
      await t.test('missing columns and constraints are added back, undeclared ones still fail', async () => {
        // Repairable: a declared column and its constraint are gone, and a
        // declared NOT NULL was relaxed. db:init must restore all three.
        await native.query(`
          ALTER TABLE public.notifications DROP CONSTRAINT notifications_pkey;
          ALTER TABLE public.notifications DROP COLUMN is_read;
          ALTER TABLE public.notifications ALTER COLUMN title DROP NOT NULL;`);
        const repairs = await initialize();
        assert.match(repairs, /repaired 3 table difference\(s\)/);
        assert.match(await initialize(), /\(no definition changes\)/, 'the repair is idempotent');
        const restored = await native.query(`
          select count(*)::int as n from information_schema.columns
          where table_schema = 'public' and table_name = 'notifications' and column_name = 'is_read'`);
        assert.equal(restored.rows[0].n, 1, 'the missing column is back');
        const title = await native.query(`
          select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'notifications' and column_name = 'title'`);
        assert.equal(title.rows[0].is_nullable, 'NO', 'the relaxed NOT NULL is back');
        const constraint = await native.query("select count(*)::int as n from pg_constraint where conname = 'notifications_pkey'");
        assert.equal(constraint.rows[0].n, 1, 'the missing primary key is back');

        // Unrepairable: an undeclared column and a renamed column need explicit SQL.
        await native.query(`
          ALTER TABLE public.notifications RENAME COLUMN is_read TO review_missing_read;
          ALTER TABLE public.notifications ADD COLUMN review_extra text;`);
        try {
          const failure = await initialize().then(() => null, error => error.message);
          // The rename looks like a missing column plus an undeclared one; the
          // undeclared half refuses the repair before anything is applied.
          assert.match(failure, /public\.notifications\.review_missing_read: column is not declared/);
          assert.match(failure, /public\.notifications\.review_extra: column is not declared/);
          assert.equal((await native.query(`
            select count(*)::int as n from information_schema.columns
            where table_schema = 'public' and table_name = 'notifications' and column_name = 'is_read'`)).rows[0].n, 0,
            'nothing is applied while tables differ');
        } finally {
          await native.query(`
            ALTER TABLE public.notifications DROP COLUMN review_extra;
            ALTER TABLE public.notifications RENAME COLUMN review_missing_read TO is_read;`);
        }
      });
      await t.test('tables recreated in one pass get their keys before the foreign keys between them', async () => {
        await native.query('DROP TABLE public.agent_eval_results, public.agent_eval_runs');
        const log = await initialize();
        assert.match(log, /created table public\.agent_eval_results/);
        assert.match(log, /created table public\.agent_eval_runs/);
        assert.match(await initialize(), /\(no definition changes\)/);
      });
      await t.test('legacy boolean settings keep their values through migration 0001', async () => {
        // The pre-1.0 column: boolean with a default that does not cast to jsonb.
        await native.query(`
          ALTER TABLE public.app_settings
            ALTER COLUMN setting_value DROP DEFAULT,
            ALTER COLUMN setting_value TYPE boolean USING setting_value::boolean,
            ALTER COLUMN setting_value SET DEFAULT false;
          INSERT INTO public.app_settings (setting_key, setting_value)
          VALUES ('feature_disabled:review-on', true), ('feature_disabled:review-off', false);
          DELETE FROM taibu_meta.schema_migrations WHERE version = '0001';`);
        try {
          assert.match(await initialize(), /✓ 0001 0001_converge_legacy_schema/);
          assert.deepEqual((await native.query(`
            SELECT setting_key, setting_value FROM public.app_settings
            WHERE setting_key LIKE 'feature_disabled:review-%' ORDER BY setting_key`)).rows, [
            { setting_key: 'feature_disabled:review-off', setting_value: false },
            { setting_key: 'feature_disabled:review-on', setting_value: true },
          ]);
          assert.match(await initialize(), /\(no definition changes\)/);
        } finally {
          await native.query("DELETE FROM public.app_settings WHERE setting_key LIKE 'feature_disabled:review-%'");
        }
      });
      await t.test('legacy subscription quotas and duplicate reports migrate before reconciliation', async () => {
        const userId = '00000000-0000-4000-8000-0000000000e1';
        const planId = '00000000-0000-4000-8000-0000000000e2';
        const subscriptionId = '00000000-0000-4000-8000-0000000000e3';
        const postId = '00000000-0000-4000-8000-0000000000e4';
        const earlierReportId = '00000000-0000-4000-8000-0000000000e5';
        const duplicateReportId = '00000000-0000-4000-8000-0000000000e6';
        await native.query(`
          DROP FUNCTION public.billing_apply_limit_reset(public.user_subscription_limits);
          DROP TABLE public.user_subscription_limits;
          DROP TABLE public.subscription_plan_limits;
          DROP INDEX IF EXISTS public.community_reports_pending_target_unique;
          ALTER TABLE public.subscription_plans
            ADD COLUMN allowance_micros bigint NOT NULL DEFAULT 25000000,
            ADD COLUMN reset_period text NOT NULL DEFAULT 'never';
          ALTER TABLE public.user_subscriptions
            ADD COLUMN allowance_micros bigint NOT NULL DEFAULT 12000000,
            ADD COLUMN reset_period text NOT NULL DEFAULT 'daily',
            ADD COLUMN used_micros bigint NOT NULL DEFAULT 3500000,
            ADD COLUMN next_reset_at timestamptz DEFAULT '2030-05-06 07:08:09+00';
        `);
        await native.query(`
          INSERT INTO identity.users (id, email, email_verified, name)
          VALUES ($1, 'legacy-billing@fixture.test', true, '旧订阅用户');
        `, [userId]);
        await native.query(`
          INSERT INTO public.subscription_plans (id, title, price_usd, allowance_micros, reset_period)
          VALUES ($1, '旧套餐', 9.99, 25000000, 'never');
        `, [planId]);
        await native.query(`
          INSERT INTO public.user_subscriptions
            (id, user_id, plan_id, title, starts_at, ends_at, status, source, allowance_micros, reset_period, used_micros, next_reset_at)
          VALUES ($1, $2, $3, '旧订阅', '2029-01-01 00:00:00+00', '2031-01-01 00:00:00+00', 'active', 'admin',
            12000000, 'daily', 3500000, '2030-05-06 07:08:09+00');
        `, [subscriptionId, userId, planId]);
        await native.query(`
          INSERT INTO public.community_posts (id, user_id, title, content, category)
          VALUES ($1, $2, '旧举报目标', '迁移验收', 'general');
        `, [postId, userId]);
        await native.query(`
          INSERT INTO public.community_reports (id, reporter_id, target_type, target_id, reason, status, created_at)
          VALUES ($1, $2, 'post', $3, 'spam', 'pending', '2029-01-01 00:00:00+00'),
                 ($4, $2, 'post', $3, 'spam', 'pending', '2029-01-02 00:00:00+00');
        `, [earlierReportId, userId, postId, duplicateReportId]);
        await native.query("DELETE FROM taibu_meta.schema_migrations WHERE version IN ('0002', '0003')");

        const log = await initialize();
        assert.match(log, /Applying 0002 0002_subscription_windows/);
        assert.match(log, /Applying 0003 0003_community_report_dedup/);
        assert.deepEqual((await native.query(`
          SELECT period, allowance_micros::text FROM public.subscription_plan_limits WHERE plan_id = $1;
        `, [planId])).rows, [{ period: 'total', allowance_micros: '25000000' }]);
        const limit = (await native.query(`
          SELECT period, allowance_micros::text, used_micros::text, next_reset_at
          FROM public.user_subscription_limits WHERE subscription_id = $1;
        `, [subscriptionId])).rows[0];
        assert.deepEqual({ ...limit, next_reset_at: limit.next_reset_at.toISOString() }, {
          period: 'daily', allowance_micros: '12000000', used_micros: '3500000', next_reset_at: '2030-05-06T07:08:09.000Z',
        });
        const oldColumns = await native.query(`
          SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = 'public' AND (
            (table_name = 'subscription_plans' AND column_name IN ('allowance_micros', 'reset_period')) OR
            (table_name = 'user_subscriptions' AND column_name IN ('allowance_micros', 'reset_period', 'used_micros', 'next_reset_at'))
          );
        `);
        assert.equal(oldColumns.rows[0].n, 0);
        const reports = (await native.query(`
          SELECT id, status, review_notes FROM public.community_reports
          WHERE reporter_id = $1 AND target_id = $2 ORDER BY created_at, id;
        `, [userId, postId])).rows;
        assert.deepEqual(reports.map(report => [report.id, report.status]), [
          [earlierReportId, 'pending'], [duplicateReportId, 'dismissed'],
        ]);
        assert.match(reports[1].review_notes, /升级时合并重复待处理举报/);
        assert.equal((await native.query(`
          SELECT count(*)::int AS n FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'community_reports_pending_target_unique';
        `)).rows[0].n, 1);
        assert.equal((await native.query(`
          SELECT baseline FROM taibu_meta.schema_migrations WHERE version = '0002';
        `)).rows[0].baseline, false);

        await native.query('DELETE FROM public.community_reports WHERE target_id = $1', [postId]);
        await native.query('DELETE FROM public.community_posts WHERE id = $1', [postId]);
        await native.query('DELETE FROM public.user_subscriptions WHERE id = $1', [subscriptionId]);
        await native.query('DELETE FROM public.subscription_plans WHERE id = $1', [planId]);
        await native.query('DELETE FROM identity.users WHERE id = $1', [userId]);
      });
      await t.test('tasks still open on the old browser provider settle as failed through migration 0004', async () => {
        const userId = '00000000-0000-4000-8000-0000000000f1';
        const [staleConversation, platformConversation] = ['00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3'];
        const [staleRun, finishedRun, platformRun] = ['00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000f6'];
        const message = (runId, status) => ({ id: `agent:${runId}`, role: 'assistant', content: '', createdAt: '2026-10-01T00:00:00Z', agent: { version: 1, runId, status, parts: [] } });
        const legacyProvider = { apiUrl: 'https://relay.example/v1', modelId: 'gpt-4.1' };
        await native.query(`INSERT INTO identity.users (id, email, email_verified, name) VALUES ($1, 'legacy-provider@fixture.test', true, '旧直连用户')`, [userId]);
        await native.query(`INSERT INTO public.conversations (id, user_id, personality, title, messages) VALUES ($1, $3, 'general', '旧直连', $4), ($2, $3, 'general', '平台', $5)`,
          [staleConversation, platformConversation, userId, JSON.stringify([message(finishedRun, 'completed'), message(staleRun, 'running')]), JSON.stringify([message(platformRun, 'running')])]);
        const run = (id, conversationId, status, input) => native.query(`
          INSERT INTO public.agent_runs (id, user_id, conversation_id, request_id, request_hash, status, input, checkpoint, public_message, billing, worker_id, lease_until)
          VALUES ($1, $2, $3, $8, 'hash', $4, $5, '{"version":2,"durable":{"engine":"pi-durable/1.4.0"}}', $6, $7, 'worker-old', now() + interval '1 hour')`,
        [id, userId, conversationId, status, JSON.stringify(input), JSON.stringify(message(id, status)), input.customProvider ? 'exempt' : 'metered', `request-${id}`]);
        await run(finishedRun, staleConversation, 'completed', { model: 'custom:gpt-4.1', customProvider: legacyProvider });
        await run(staleRun, staleConversation, 'running', { model: 'custom:gpt-4.1', customProvider: legacyProvider, title: '旧直连任务' });
        await run(platformRun, platformConversation, 'running', { model: 'fixture-analysis' });
        await native.query(`INSERT INTO public.agent_run_credentials (run_id, ciphertext) VALUES ($1, '{"v":1}'), ($2, '{"v":2}')`, [staleRun, platformRun]);
        await native.query("DELETE FROM taibu_meta.schema_migrations WHERE version = '0004'");

        assert.match(await initialize(), /Applying 0004 0004_retire_browser_provider_runs/);
        const runs = Object.fromEntries((await native.query(`
          SELECT id, status, worker_id, lease_until, public_message #>> '{agent,status}' AS shown, public_message #>> '{agent,error}' AS note
          FROM public.agent_runs WHERE user_id = $1`, [userId])).rows.map(row => [row.id, row]));
        assert.deepEqual([runs[staleRun].status, runs[staleRun].shown, runs[staleRun].worker_id, runs[staleRun].lease_until], ['failed', 'failed', null, null]);
        assert.match(runs[staleRun].note, /设置 → 自定义模型/u);
        assert.deepEqual([runs[finishedRun].status, runs[platformRun].status, runs[platformRun].worker_id], ['completed', 'running', 'worker-old'],
          'a finished task and a platform task are left alone');
        assert.deepEqual((await native.query('SELECT run_id FROM public.agent_run_credentials WHERE run_id = ANY($1) ORDER BY run_id', [[staleRun, platformRun]])).rows.map(row => row.run_id),
          [platformRun], 'only the retired task\'s staged key is dropped');
        const shown = (await native.query('SELECT messages FROM public.conversations WHERE id = $1', [staleConversation])).rows[0].messages;
        assert.deepEqual(shown.map(item => [item.id, item.agent.status]), [[`agent:${finishedRun}`, 'completed'], [`agent:${staleRun}`, 'failed']],
          'the conversation shows the task as stopped');
        assert.equal((await native.query(`SELECT count(*)::int AS n FROM public.notifications WHERE event_key = $1`, [`agent:${staleRun}:failed`])).rows[0].n, 1,
          'its owner is told the task stopped');

        await native.query('DELETE FROM public.agent_runs WHERE user_id = $1', [userId]);
        await native.query('DELETE FROM public.notifications WHERE user_id = $1', [userId]);
        await native.query('DELETE FROM public.conversations WHERE user_id = $1', [userId]);
        await native.query('DELETE FROM identity.users WHERE id = $1', [userId]);
      });
      await t.test('db:init --check lists pending migrations without touching the ledger or a legacy table', async () => {
        await native.query('DROP SCHEMA taibu_meta CASCADE');
        // Only a pending migration drops this column, so completion cannot be planned before it runs.
        await native.query('ALTER TABLE public.users ADD COLUMN membership text');
        try {
          const before = (await native.query(`
            SELECT md5(string_agg(x, ',' ORDER BY x)) AS hash FROM (
              SELECT oid::text || ':' || xmin::text AS x FROM pg_class
              UNION ALL SELECT oid::text || ':' || xmin::text FROM pg_proc
              UNION ALL SELECT oid::text || ':' || xmin::text FROM pg_policy
              UNION ALL SELECT oid::text || ':' || xmin::text FROM pg_trigger
            ) objects;
          `)).rows[0].hash;
          const output = await initialize(database, ['--check']);
          const migrations = (await readdir(path.join(repoRoot, 'database', 'migrations'))).filter(name => name.endsWith('.sql')).length;
          assert.match(output, /Migration ledger is missing/u);
          assert.match(output, new RegExp(`Would apply ${migrations} migration\\(s\\)`, 'u'));
          assert.match(output, /planned after the pending migrations/u);
          assert.equal((await native.query("SELECT to_regclass('taibu_meta.schema_migrations') AS ledger")).rows[0].ledger, null);
          const after = (await native.query(`
            SELECT md5(string_agg(x, ',' ORDER BY x)) AS hash FROM (
              SELECT oid::text || ':' || xmin::text AS x FROM pg_class
              UNION ALL SELECT oid::text || ':' || xmin::text FROM pg_proc
              UNION ALL SELECT oid::text || ':' || xmin::text FROM pg_policy
              UNION ALL SELECT oid::text || ':' || xmin::text FROM pg_trigger
            ) objects;
          `)).rows[0].hash;
          assert.equal(after, before, 'check-only must not change catalog objects');
        } finally {
          await native.query('ALTER TABLE public.users DROP COLUMN membership');
        }
      });
      await t.test('retired principals are not created', async () => {
        assert.equal((await native.query("select count(*)::int as n from pg_roles where rolname in ('service_role','taibu_migrator')")).rows[0].n, 0);
      });
    } finally { await native.end(); }

    await t.test('selfhost binary subprocess transport restores a readable custom-format backup', async () => {
      const fixtureSql = 'create table public.review_restore_fixture (value text); insert into public.review_restore_fixture values (\'备份恢复验收\')';
      await sql(fixtureSql);
      try {
        const dump = await execute('docker', ['exec', containerId, 'pg_dump', '-U', 'postgres', '-d', database,
          '-Fc', '--no-owner', '--no-privileges', '-t', 'public.review_restore_fixture'], { binary: true });
        await sql('drop table public.review_restore_fixture');
        await execute('docker', ['exec', '-i', containerId, 'pg_restore', '-U', 'postgres', '-d', database,
          '--no-owner', '--no-privileges', '--exit-on-error'], { input: dump });
        assert.equal(await sql('select value from public.review_restore_fixture'), '备份恢复验收');
      } finally { await sql('drop table if exists public.review_restore_fixture'); }
    });

    await t.test('legacy auth and rate-limit objects are gone', async () => {
      assert.equal(await sql(`
        select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('login_attempts', 'rate_limits');`), '0');
      assert.equal(await sql(`
        select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'auth' and c.relname = 'users' and c.relkind = 'r';`), '0');
      assert.equal(await sql(`
        select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in
          ('handle_auth_user_profile_sync','check_login_attempts','record_login_attempt','consume_rate_limit_slot_as_admin');`), '0');
    });

    await t.test('foreign keys point at public.users and identity.users only', async () => {
      const rows = (await sql(`
        select confrelid::regclass::text || '|' || conname || '|' || confdeltype::text
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'f' and n.nspname = 'public'
          and confrelid in ('identity.users'::regclass);`)).split('\n').filter(Boolean);
      assert.deepEqual(rows, ['identity.users|users_id_fkey|c']);
      const userFks = await sql(`
        select count(*) from pg_constraint c
        join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'f' and n.nspname = 'public' and confrelid = 'public.users'::regclass;`);
      assert.ok(Number(userFks) >= 32, `expected at least 32 public.users foreign keys, got ${userFks}`);
    });

    await t.test('identity trigger seeds public.users and the system user is admin', async () => {
      await sql(`insert into identity.users (id, email, email_verified, name)
        values ('00000000-0000-4000-8000-0000000000aa', 'trigger@fixture.test', true, '触发器用户');`);
      assert.equal(await sql(`select nickname from public.users where id = '00000000-0000-4000-8000-0000000000aa';`), '触发器用户');
      assert.equal(await sql(`select is_admin from public.users where id = '00000000-0000-4000-8000-000000000001';`), 't');
    });

    await t.test('Agent wake-up triggers and indexes are installed', async () => {
      const triggers = (await sql(`
        select tgname from pg_trigger
        where not tgisinternal and tgname like 'agent_notify_%'
        order by tgname;`)).split('\n').filter(Boolean);
      assert.deepEqual(triggers, ['agent_notify_command', 'agent_notify_event', 'agent_notify_run']);
      const indexes = (await sql(`
        select indexname from pg_indexes
        where indexname in ('agent_claim_queued','agent_claim_expired','knowledge_entries_vector_1024_hnsw_idx')
        order by indexname;`)).split('\n').filter(Boolean);
      assert.deepEqual(indexes, ['agent_claim_expired', 'agent_claim_queued', 'knowledge_entries_vector_1024_hnsw_idx']);
      assert.equal(await sql(`
        select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'knowledge_entries'
          and column_name = 'embedding_dim' and is_generated = 'ALWAYS';`), '1');
      assert.equal(await sql(`
        select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in
          ('delete_agent_retention','cleanup_expired_identity_rows');`), '2');
      // The claim predicate must prefer the partial index even before data exists.
      const plan = await sql(`
        set enable_seqscan = off;
        explain select id from public.agent_runs
        where status = 'queued'
          and checkpoint->>'version' = '2'
          and checkpoint#>>'{durable,engine}' = 'pi-durable/1.4.0'
        order by created_at limit 1;`);
      assert.match(plan, /agent_claim_queued/u);
    });

    await t.test('vector search can use the 1024-dimension HNSW index', async () => {
      await sql(`
        insert into knowledge_bases (id, user_id, name) values
          ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000aa', '向量测试');
        insert into knowledge_entries (id, kb_id, content, content_vector, source_type, source_id, metadata) values
          ('00000000-0000-4000-8000-0000000000cc',
           '00000000-0000-4000-8000-0000000000bb',
           '向量内容',
           array_fill(0.1::float8, ARRAY[1024])::extensions.vector(1024),
           'note', 'fixture',
           '{"embedding_model":"fixture","embedding_dim":1024}'::jsonb);`);
      const plan = await sql(`
        set enable_seqscan = off;
        explain select id from public.knowledge_entries
        where embedding_dim = 1024
          and content_vector is not null
        order by content_vector::extensions.vector(1024) OPERATOR(extensions.<=>) array_fill(0.1::float8, ARRAY[1024])::extensions.vector(1024)
        limit 5;`);
      assert.match(plan, /knowledge_entries_vector_1024_hnsw_idx/u);
    });

    await t.test('RLS is enabled on every public table', async () => {
      const unprotected = await sql(`
        select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;`);
      assert.equal(unprotected, '0');
    });

    await t.test('notification acknowledgement grants exclude server-authored fields', async () => {
      assert.equal(await sql("select has_column_privilege('authenticated','public.notifications','is_read','UPDATE')"), 't');
      for (const column of ['title', 'content', 'event_data', 'link', 'user_id']) {
        assert.equal(await sql(`select has_column_privilege('authenticated','public.notifications','${column}','UPDATE')`), 'f', column);
      }
      await sql(`insert into public.notifications (id,user_id,type,title,content) values
        ('00000000-0000-4000-8000-0000000000dd','00000000-0000-4000-8000-0000000000aa','system','通知','内容');`);
      await sql(`set role authenticated; set request.jwt.claims='{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}';
        update public.notifications set is_read=true where id='00000000-0000-4000-8000-0000000000dd';`);
      await assert.rejects(sql(`set role authenticated; set request.jwt.claims='{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}';
        update public.notifications set title='伪造' where id='00000000-0000-4000-8000-0000000000dd';`), /permission denied/);
    });

    await t.test('the application role fails closed without a scoped transaction', async () => {
      const psqlAsApp = (statement) => docker([
        'exec', '-e', `PGPASSWORD=${appPassword}`, '-i', containerId,
        'psql', '-X', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1',
        '-h', '127.0.0.1', '-U', 'taibu_app', '-d', database,
      ], { input: statement });

      await assert.rejects(psqlAsApp('select count(*) from public.users;'), /permission denied|denied/u);

      const visible = await psqlAsApp(`
        begin;
        select set_config('role', 'authenticated', true),
               set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);
        select count(*) from public.users where id = '00000000-0000-4000-8000-0000000000aa';
        commit;`);
      assert.ok(visible.split('\n').includes('1'), visible);
    });
  } finally {
    await cleanup();
  }
});
