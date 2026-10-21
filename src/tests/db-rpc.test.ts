import assert from 'node:assert/strict';
import test from 'node:test';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import type { DB } from '../lib/db/generated/schema';
import { buildRpcStatement } from '../lib/db/rpc';

const compiler = new Kysely<DB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

test('RPC uses named notation with explicit PostgreSQL casts', () => {
  const compiled = buildRpcStatement('agent_cache_tool', {
    p_run_id: '00000000-0000-4000-8000-000000000001',
    p_worker_id: 'worker',
    p_fence: 3,
    p_call_id: 'call',
    p_tool_name: 'read_user_data',
    p_kind: 'artifacts',
    p_args: { a: 1 },
    p_result: { ok: true },
  }).compile(compiler);
  assert.match(compiled.sql, /^select \* from "public"\."agent_cache_tool"\(/);
  assert.match(compiled.sql, /"p_run_id" => \$1::uuid/);
  assert.match(compiled.sql, /"p_fence" => \$3::bigint/);
  assert.match(compiled.sql, /"p_args" => \$7::jsonb/);
  assert.deepEqual(compiled.parameters[6], '{"a":1}');
  assert.deepEqual(compiled.parameters[7], '{"ok":true}');
});

test('arguments are bound, never interpolated', () => {
  const compiled = buildRpcStatement('agent_change_command', {
    p_run_id: '00000000-0000-4000-8000-000000000001',
    p_sequence: 1,
    p_revision: 1,
    p_action: "stop'; drop table users; --",
  }).compile(compiler);
  assert.ok(compiled.parameters.includes("stop'; drop table users; --"));
  assert.doesNotMatch(compiled.sql, /drop table users/u);
});

test('trailing defaulted arguments may be omitted', () => {
  const compiled = buildRpcStatement('agent_admin_task_log', {
    p_run_id: '00000000-0000-4000-8000-000000000001',
  }).compile(compiler);
  assert.doesNotMatch(compiled.sql, /p_after/u);
  assert.equal(compiled.parameters.length, 1);
});

test('missing required arguments fail before touching the database', () => {
  assert.throws(() => buildRpcStatement('agent_cache_tool', {} as never), /缺少参数/u);
});
