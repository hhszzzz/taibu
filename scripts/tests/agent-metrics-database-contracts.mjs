import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;

/** agent_run_metrics: run performance is the administrators' data, and the retention function ages it out by 30 days. */
export async function agentMetricsDatabaseContracts(t, { sql, asActor, adminId }) {
  const member = randomUUID();
  const conversation = randomUUID();
  const run = randomUUID();
  const runId = quote(run);
  const metric = (id, extra = {}) => {
    const columns = {
      run_id: id, model_id: 'fixture-model', status: 'completed', queued_ms: 120, total_ms: 4000,
      first_token_ms: 800, generation_count: 2, generation_ms: 3000, tool_count: 1, tool_ms: 1000,
      compaction_count: 0, compaction_ms: 0, retries: 1, faults: 0, hangs: 0,
      input_tokens: 100, output_tokens: 40, cache_read_tokens: 60, cache_write_tokens: 0, total_tokens: 200,
      phases: { sql: json([{ name: 'pi.durable.phase', task: 'pi.generation', phase: 'request', status: 'ok', startMs: 0, durationMs: 900 }]) },
      started_at: { sql: 'now()' }, ended_at: { sql: 'now()' }, ...extra,
    };
    const value = (v) => v === null ? 'NULL' : typeof v === 'object' ? v.sql : quote(v);
    return `INSERT INTO public.agent_run_metrics(${Object.keys(columns).join(',')})
      VALUES(${Object.values(columns).map(value).join(',')}) RETURNING run_id;`;
  };

  await sql(`INSERT INTO identity.users(id) VALUES(${quote(member)});`);
  await sql(`INSERT INTO public.conversations(id,user_id,title) VALUES(${quote(conversation)},${quote(member)},'metrics fixture');`);
  await sql(`INSERT INTO public.agent_runs(id,user_id,conversation_id,request_id,request_hash,input,checkpoint,public_message,billing,status)
    VALUES(${runId},${quote(member)},${quote(conversation)},'metrics-request','metrics-hash','{}'::jsonb,
      ${json({ version: 2, durable: { engine: 'pi-durable/1.4.0' }, messages: [], parts: [] })},'{}'::jsonb,'exempt','completed');`);

  await t.test('run metrics are written and read by administrators only', async () => {
    assert.equal(await asActor(adminId, metric(run)), run);
    assert.equal(await asActor(adminId, `SELECT model_id || ':' || status || ':' || total_ms FROM public.agent_run_metrics WHERE run_id=${runId};`),
      'fixture-model:completed:4000');
    assert.equal(await asActor(member, 'SELECT count(*) FROM public.agent_run_metrics;'), '0', 'a member reads no metrics');
    await assert.rejects(asActor(member, metric(randomUUID())), /42501/, 'a member writes none');
    await assert.rejects(asActor(null, 'SELECT count(*) FROM public.agent_run_metrics;', 'anon'), /42501/);
    assert.equal(await asActor(adminId, `DELETE FROM public.agent_run_metrics WHERE run_id=${runId} RETURNING run_id;`), run);
  });

  await t.test('the metrics table rejects shapes the application never writes', async () => {
    for (const extra of [
      { status: 'running' }, { total_ms: -1 }, { first_token_ms: -2 }, { hangs: -1 }, { model_id: '' },
      { phases: { sql: "'{}'::jsonb" } }, { ended_at: { sql: "now() - interval '1 day'" } },
    ]) {
      const other = randomUUID();
      await sql(`INSERT INTO public.agent_runs(id,user_id,conversation_id,request_id,request_hash,input,checkpoint,public_message,billing,status)
        VALUES(${quote(other)},${quote(member)},${quote(conversation)},${quote(`request-${other}`)},'hash','{}'::jsonb,
          ${json({ version: 2, durable: { engine: 'pi-durable/1.4.0' }, messages: [], parts: [] })},'{}'::jsonb,'exempt','completed');`);
      await assert.rejects(asActor(adminId, metric(other, extra)), /23514/, JSON.stringify(extra));
    }
  });

  await t.test('the summary function returns per-model percentiles to administrators only', async () => {
    const addRun = async (id) => sql(`INSERT INTO public.agent_runs(id,user_id,conversation_id,request_id,request_hash,input,checkpoint,public_message,billing,status)
      VALUES(${quote(id)},${quote(member)},${quote(conversation)},${quote(`request-${id}`)},'hash','{}'::jsonb,
        ${json({ version: 2, durable: { engine: 'pi-durable/1.4.0' }, messages: [], parts: [] })},'{}'::jsonb,'exempt','completed');`);
    const fast = randomUUID();
    const slow = randomUUID();
    await addRun(fast);
    await addRun(slow);
    await asActor(adminId, metric(fast, { model_id: 'summary-model', total_ms: 1000, first_token_ms: null, tool_ms: 0 }));
    await asActor(adminId, metric(slow, { model_id: 'summary-model', total_ms: 4000, tool_ms: 1000, status: 'failed', hangs: 1 }));
    assert.equal(await asActor(adminId, 'SELECT model_id || \':\' || runs || \':\' || p50_total_ms || \':\' || p95_total_ms || \':\' || p50_first_token_ms || \':\' || p95_first_token_ms || \':\' || tool_share || \':\' || failure_rate || \':\' || hang_rate FROM public.agent_run_metrics_summary(7);'),
      'summary-model:2:2500:3850:800:800:0.2:0.5:0.5');
    await assert.rejects(asActor(member, 'SELECT * FROM public.agent_run_metrics_summary(7);'), /42501/);
    await assert.rejects(asActor(adminId, 'SELECT * FROM public.agent_run_metrics_summary(0);'), /invalid metrics window/);
    await asActor(adminId, `DELETE FROM public.agent_run_metrics WHERE run_id IN (${quote(fast)},${quote(slow)});`);
  });

  await t.test('retention deletes metrics older than the configured horizon', async () => {
    const old = randomUUID();
    await sql(`INSERT INTO public.agent_runs(id,user_id,conversation_id,request_id,request_hash,input,checkpoint,public_message,billing,status,updated_at)
      VALUES(${quote(old)},${quote(member)},${quote(conversation)},${quote(`request-${old}`)},'hash','{}'::jsonb,
        ${json({ version: 2, durable: { engine: 'pi-durable/1.4.0' }, messages: [], parts: [] })},'{}'::jsonb,'exempt','completed',now() - interval '40 days');`);
    await asActor(adminId, metric(run));
    await asActor(adminId, metric(old, { ended_at: { sql: "now() - interval '40 days'" }, started_at: { sql: "now() - interval '41 days'" } }));
    assert.equal(await asActor(adminId, 'SELECT metrics_deleted FROM public.delete_agent_retention(30,7,24,1000,30);'), '1');
    assert.equal(await asActor(adminId, `SELECT count(*) FROM public.agent_run_metrics WHERE run_id=${runId};`), '1', 'a recent row stays');
    assert.equal(await asActor(adminId, `SELECT count(*) FROM public.agent_run_metrics WHERE run_id=${quote(old)};`), '0');
    await assert.rejects(asActor(adminId, 'SELECT * FROM public.delete_agent_retention(30,7,24,1000,0);'), /invalid retention bounds/);
    await assert.rejects(asActor(member, 'SELECT * FROM public.delete_agent_retention();'), /42501/);
  });
}
