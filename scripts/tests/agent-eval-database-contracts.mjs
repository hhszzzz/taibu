import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;

/** agent_eval_cases / agent_eval_runs / agent_eval_results: the evaluation workspace is the administrators' data. */
export async function agentEvalDatabaseContracts(t, { sql, asActor, adminId }) {
  const caseId = 'bazi-contract';
  const run = randomUUID();

  /** A scalar is quoted, a boolean/number stays literal, `{ sql }` is an expression, `null` is NULL. */
  const value = (v) => v === null ? 'NULL' : typeof v === 'object' ? v.sql : typeof v === 'boolean' || typeof v === 'number' ? String(v) : quote(v);
  const insertRow = (table, columns) => `INSERT INTO public.${table}(${Object.keys(columns).join(',')})
    VALUES(${Object.values(columns).map(value).join(',')}) RETURNING id;`;

  const caseRow = (id, extra = {}) => insertRow('agent_eval_cases', {
    id, tool: 'bazi', guide: 'bazi', prompt: '排八字', assertions: { sql: json(['断言']) },
    arguments: { sql: json({ gender: 'male' }) }, chart: null, visual: false, builtin: false,
    is_enabled: true, sort_order: 0, ...extra,
  });
  const runRow = (id, extra = {}) => insertRow('agent_eval_runs', {
    id, created_by: adminId, models: { sql: "ARRAY['model-a']::text[]" }, judge_model: 'judge',
    case_ids: { sql: `ARRAY[${quote(caseId)}]::text[]` }, repeats: 1, total_calls: 1, completed_calls: 0,
    status: 'queued', ...extra,
  });
  const resultRow = (id, extra = {}) => insertRow('agent_eval_results', {
    id, run_id: run, case_id: caseId, model_id: 'model-a', repeat: 1,
    hard_passed: true, quality_passed: true, failed_assertions: { sql: json([]) },
    answer: '答案', judge_response: '{"passed":true,"failedAssertions":[]}',
    tool_trace: { sql: json([{ name: 'bazi', status: 'ok' }]) }, tool_calls: 1, duration_ms: 1000,
    first_token_ms: 200, input_tokens: 100, output_tokens: 40, total_tokens: 140, ...extra,
  });

  await t.test('evaluation cases, runs and results are visible to administrators only', async () => {
    assert.equal(await asActor(adminId, caseRow(caseId)), caseId);
    assert.equal(await asActor(adminId, `SELECT tool || ':' || guide FROM public.agent_eval_cases WHERE id=${quote(caseId)};`), 'bazi:bazi');
    assert.equal(await asActor(adminId, runRow(run)), run);
    const result = randomUUID();
    assert.equal(await asActor(adminId, resultRow(result)), result);
    assert.equal(await asActor(adminId, `SELECT hard_passed || ':' || tool_calls FROM public.agent_eval_results WHERE id=${quote(result)};`), 'true:1');

    const member = randomUUID();
    await sql(`INSERT INTO identity.users(id) VALUES(${quote(member)});`);
    assert.equal(await asActor(member, 'SELECT count(*) FROM public.agent_eval_cases;'), '0', 'a member reads no cases');
    assert.equal(await asActor(member, 'SELECT count(*) FROM public.agent_eval_runs;'), '0', 'a member reads no runs');
    assert.equal(await asActor(member, 'SELECT count(*) FROM public.agent_eval_results;'), '0', 'a member reads no results');
    await assert.rejects(asActor(member, caseRow('member-case')), /42501/, 'a member writes no case');
    await assert.rejects(asActor(member, runRow(randomUUID())), /42501/, 'a member starts no run');
    await assert.rejects(asActor(member, resultRow(randomUUID())), /42501/, 'a member writes no result');
    await assert.rejects(asActor(null, 'SELECT count(*) FROM public.agent_eval_runs;', 'anon'), /42501/);
  });

  await t.test('evaluation tables reject shapes the application never writes', async () => {
    for (const extra of [
      { id: 'Bad' }, { tool: '' }, { guide: '' }, { prompt: '' },
      { assertions: { sql: "'{}'::jsonb" } }, { arguments: { sql: "'[]'::jsonb" } }, { chart: { sql: "'[]'::jsonb" } },
    ]) {
      await assert.rejects(asActor(adminId, caseRow(randomUUID(), extra)), /23514/, JSON.stringify(extra));
    }
    for (const extra of [
      { total_calls: 0 }, { total_calls: 201 }, { completed_calls: 2 }, { repeats: 0 }, { repeats: 6 },
      { status: 'paused' }, { models: { sql: "'{}'::text[]" } }, { case_ids: { sql: "'{}'::text[]" } },
      { started_at: { sql: 'now()' }, ended_at: { sql: "now() - interval '1 day'" }, status: 'failed' },
    ]) {
      await assert.rejects(asActor(adminId, runRow(randomUUID(), extra)), /23514/, JSON.stringify(extra));
    }
    for (const extra of [
      { hard_passed: false, quality_passed: true }, { duration_ms: -1 }, { first_token_ms: -2 },
      { tool_calls: -1 }, { total_tokens: -1 }, { repeat: 0 },
      { tool_trace: { sql: "'{}'::jsonb" } }, { failed_assertions: { sql: "'{}'::jsonb" } },
    ]) {
      await assert.rejects(asActor(adminId, resultRow(randomUUID(), extra)), /23514/, JSON.stringify(extra));
    }
    await asActor(adminId, resultRow(randomUUID(), { repeat: 2 }));
    await assert.rejects(asActor(adminId, resultRow(randomUUID(), { repeat: 2 })), /23505/, 'one result per case, model and repeat');
  });

  await t.test('deleting a run deletes its results but keeps the cases', async () => {
    assert.equal(await asActor(adminId, `DELETE FROM public.agent_eval_runs WHERE id=${quote(run)} RETURNING id;`), run);
    assert.equal(await asActor(adminId, `SELECT count(*) FROM public.agent_eval_results WHERE run_id=${quote(run)};`), '0');
    assert.equal(await asActor(adminId, `SELECT count(*) FROM public.agent_eval_cases WHERE id=${quote(caseId)};`), '1');
    assert.equal(await asActor(adminId, `DELETE FROM public.agent_eval_cases WHERE id=${quote(caseId)} RETURNING id;`), caseId);
  });
}
