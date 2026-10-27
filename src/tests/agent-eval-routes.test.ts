import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { AgentEvalInputError, parseAgentEvalLaunch, parseEvalCaseInput } from '../lib/agent/eval/service.server';
import type { AgentEvalRunView } from '../lib/agent/eval/types';

function modules() {
  return {
    apiUtils: require('../lib/api-utils') as typeof import('../lib/api-utils'),
    service: require('../lib/agent/eval/service.server') as typeof import('../lib/agent/eval/service.server'),
  };
}

const request = (path: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://localhost${path}`, {
    method: init?.method ?? 'GET',
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: { 'Content-Type': 'application/json' },
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const RUN: AgentEvalRunView = {
  id: '00000000-0000-4000-8000-000000000001', createdBy: 'admin-1', models: ['model-a'], judgeModel: 'model-b',
  caseIds: ['bazi'], repeats: 1, totalCalls: 1, completedCalls: 0, status: 'queued', cancelRequested: false,
  error: null, startedAt: null, endedAt: null, createdAt: '2026-10-28T00:00:00.000Z',
};

function denyAdmin(t: TestContext) {
  const { apiUtils, service } = modules();
  t.mock.method(apiUtils, 'requireAdminUser', async () => ({ error: { message: '需要管理员权限', status: 403 } }) as never);
  const calls = {
    list: t.mock.method(service, 'listAgentEvalRuns', async () => ({ runs: [], models: [] })),
    cases: t.mock.method(service, 'listAgentEvalCases', async () => []),
    launch: t.mock.method(service, 'launchAgentEval', async () => RUN),
    run: t.mock.method(service, 'readAgentEvalRun', async () => RUN),
    results: t.mock.method(service, 'readAgentEvalResults', async () => ({ results: [], leaderboard: [] })),
    cancel: t.mock.method(service, 'cancelAgentEvalRun', async () => RUN),
  };
  return calls;
}

test('every Agent evaluation route refuses non-administrators before reading anything', async (t) => {
  const calls = denyAdmin(t);
  const overview = await import('../app/api/admin/agent-evals/route');
  const cases = await import('../app/api/admin/agent-evals/cases/route');
  const detail = await import('../app/api/admin/agent-evals/[id]/route');
  const results = await import('../app/api/admin/agent-evals/[id]/results/route');
  const cancel = await import('../app/api/admin/agent-evals/[id]/cancel/route');
  const path = '/api/admin/agent-evals';
  for (const response of [
    await overview.GET(request(path)),
    await overview.POST(request(path, { method: 'POST', body: { models: ['a'], judgeModel: 'b', caseIds: ['c'], repeats: 1 } })),
    await cases.GET(request(`${path}/cases`)),
    await cases.POST(request(`${path}/cases`, { method: 'POST', body: {} })),
    await detail.GET(request(`${path}/${RUN.id}`), params(RUN.id)),
    await results.GET(request(`${path}/${RUN.id}/results`), params(RUN.id)),
    await cancel.POST(request(`${path}/${RUN.id}/cancel`, { method: 'POST' }), params(RUN.id)),
  ]) {
    assert.equal(response.status, 403);
  }
  assert.equal(
    calls.list.mock.callCount() + calls.cases.mock.callCount() + calls.launch.mock.callCount() + calls.run.mock.callCount()
      + calls.results.mock.callCount() + calls.cancel.mock.callCount(),
    0,
  );
});

test('launch input refuses empty selections, duplicates and more than 200 calls', () => {
  assert.deepEqual(parseAgentEvalLaunch({ models: ['m1'], judgeModel: 'judge', caseIds: ['c1', 'c2'], repeats: 2 }),
    { models: ['m1'], judgeModel: 'judge', caseIds: ['c1', 'c2'], repeats: 2 });
  for (const body of [
    {},
    { models: [], judgeModel: 'judge', caseIds: ['c1'], repeats: 1 },
    { models: ['m1', 'm1'], judgeModel: 'judge', caseIds: ['c1'], repeats: 1 },
    { models: ['m1'], judgeModel: 'judge', caseIds: ['c1'], repeats: 0 },
    { models: ['m1'], judgeModel: 'judge', caseIds: ['c1'], repeats: 6 },
    { models: Array.from({ length: 10 }, (_, index) => `m${index}`), judgeModel: 'judge', caseIds: Array.from({ length: 21 }, (_, index) => `c${index}`), repeats: 1 },
  ]) {
    assert.throws(() => parseAgentEvalLaunch(body), AgentEvalInputError, JSON.stringify(body));
  }
  // 1 model × 100 cases × 2 repeats is exactly the 200-call cap.
  assert.equal(parseAgentEvalLaunch({ models: ['m1'], judgeModel: 'judge', caseIds: Array.from({ length: 100 }, (_, index) => `c${index}`), repeats: 2 }).caseIds.length, 100);
});

test('case input validates the id, the assertions and the JSON fields', () => {
  const fields = parseEvalCaseInput({
    tool: 'bazi', guide: 'bazi', prompt: '排盘', assertions: ['断言'],
    arguments: { gender: 'male' }, chart: null, visual: true, enabled: false,
  }, { requireId: false });
  assert.match(fields.id, /^[0-9a-f-]{36}$/u);
  assert.deepEqual([fields.tool, fields.guide, fields.arguments, fields.visual, fields.enabled], ['bazi', 'bazi', { gender: 'male' }, true, false]);
  assert.throws(() => parseEvalCaseInput({ id: 'Bad', tool: 'bazi', guide: 'bazi', prompt: 'x', assertions: ['a'] }, { requireId: true }), AgentEvalInputError);
  assert.throws(() => parseEvalCaseInput({ tool: 'bazi', guide: 'bazi', prompt: 'x', assertions: [] }, { requireId: false }), AgentEvalInputError);
  assert.throws(() => parseEvalCaseInput({ tool: 'bazi', guide: 'bazi', prompt: 'x', assertions: ['a'], arguments: [] }, { requireId: false }), AgentEvalInputError);
  assert.throws(() => parseEvalCaseInput({ tool: 'bazi', guide: 'bazi', prompt: 'x', assertions: ['a'], chart: { arguments: {} } }, { requireId: false }), AgentEvalInputError);
});
