import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { ScopedDb } from '../lib/db/context.server';
import type { AgentRunRow } from '../lib/agent/store.server';
import {
  agentScheduleLocalParts, dailyBriefingScheduleDefaults, expandAgentSchedulePrompt, previewAgentSchedulePrompt,
  normalizeAgentScheduleCadence, normalizeAgentScheduleLimits, normalizeAgentScheduleOptions,
  parseAgentScheduleInput,
} from '../lib/agent/schedules/config';

test('schedule cadences reject impossible times and normalize their own fields', () => {
  assert.deepEqual(normalizeAgentScheduleCadence({ kind: 'daily', time: '08:00' }), { kind: 'daily', time: '08:00' });
  assert.deepEqual(normalizeAgentScheduleCadence({ kind: 'weekly', weekdays: [5, 1, 5, 3], time: '09:30' }), { kind: 'weekly', weekdays: [1, 3, 5], time: '09:30' });
  assert.deepEqual(normalizeAgentScheduleCadence({ kind: 'monthly', day: 31, time: '23:59' }), { kind: 'monthly', day: 31, time: '23:59' });
  assert.deepEqual(normalizeAgentScheduleCadence({ kind: 'interval', hours: 6, time: '08:00' }), { kind: 'interval', hours: 6, time: '08:00' });
  for (const value of [
    { kind: 'daily', time: '24:00' }, { kind: 'daily' }, { kind: 'weekly', weekdays: [], time: '08:00' },
    { kind: 'weekly', weekdays: [0], time: '08:00' }, { kind: 'monthly', day: 32, time: '08:00' },
    { kind: 'interval', hours: 25, time: '08:00' }, { kind: 'yearly', time: '08:00' }, 'daily',
  ]) assert.equal(normalizeAgentScheduleCadence(value), null, JSON.stringify(value));
});

test('schedule input caps the name and prompt and requires a real time zone', () => {
  const cadence = { kind: 'daily', time: '08:00' };
  assert.deepEqual(parseAgentScheduleInput({ name: ' 早报 ', prompt: ' 生成 ', cadence, timezone: 'Asia/Shanghai' }), {
    name: '早报', template: 'custom', prompt: '生成', cadence, timezone: 'Asia/Shanghai', options: normalizeAgentScheduleOptions(undefined),
  });
  assert.throws(() => parseAgentScheduleInput({ name: '', prompt: '内容', cadence, timezone: 'Asia/Shanghai' }), /任务名称/);
  assert.throws(() => parseAgentScheduleInput({ name: '名称', prompt: 'x'.repeat(4001), cadence, timezone: 'Asia/Shanghai' }), /执行内容/);
  assert.throws(() => parseAgentScheduleInput({ name: '名称', prompt: '内容', cadence, timezone: 'Mars/Olympus' }), /时区/);
  assert.throws(() => parseAgentScheduleInput({ name: '名称', prompt: '内容', cadence, timezone: 'Asia/Shanghai', template: 'unknown' }), /模板/);
});

test('schedule options keep only known fields and fall back safely', () => {
  assert.deepEqual(normalizeAgentScheduleOptions({
    model: ' fixture ', reasoning: true, reasoningEffort: 'high', webEnabled: false,
    knowledgeBaseIds: ['11111111-1111-4111-8111-111111111111', 'bad', '11111111-1111-4111-8111-111111111111'],
    baziChartId: '22222222-2222-4222-8222-222222222222', notify: false,
  }), {
    model: 'fixture', reasoning: true, reasoningEffort: 'high', webEnabled: false,
    knowledgeBaseIds: ['11111111-1111-4111-8111-111111111111'],
    baziChartId: '22222222-2222-4222-8222-222222222222', collaborators: [], notify: false,
  });
  assert.deepEqual(normalizeAgentScheduleOptions({ model: 42, reasoningEffort: 'unknown', collaborators: 'bad', notify: 'no' }), normalizeAgentScheduleOptions(undefined));
  assert.deepEqual(normalizeAgentScheduleLimits({ limit: '0' }), { limit: 0 });
  assert.deepEqual(normalizeAgentScheduleLimits({ limit: 500 }), { limit: 20 });
  assert.deepEqual(normalizeAgentScheduleLimits({ free: 1, plus: 5, pro: 8 }), { limit: 20 }, 'a tiered value falls back to the single default');
  assert.deepEqual(normalizeAgentScheduleLimits('bad'), { limit: 20 });
});

test('prompt variables only remain for legacy tasks and never appear raw on a card', () => {
  const content = expandAgentSchedulePrompt('{{date}} {{weekday}} {{time}} {{timezone}} {{name}} {{unknown}}', {
    scheduledFor: '2026-10-29T00:00:00Z', timezone: 'Asia/Shanghai', name: '早报',
  });
  assert.equal(content, '2026-10-29 周四 08:00 Asia/Shanghai 早报 {{unknown}}');
  assert.deepEqual(agentScheduleLocalParts(new Date('2026-03-08T04:30:00Z'), 'America/New_York'), { date: '2026-03-07', time: '23:30', weekday: '周六' });
  assert.equal(previewAgentSchedulePrompt('今天是 {{date}}（{{weekday}}），看黄历。'), '今天是 当天（当天），看黄历。');
  assert.equal(previewAgentSchedulePrompt('整理  {{name}}  的重点'), '整理 任务名 的重点');
  assert.equal(previewAgentSchedulePrompt('{{unknown}} 保持原样'), '{{unknown}} 保持原样');
});

test('the daily briefing template is a plain request with no tools, IDs or variables', () => {
  const template = dailyBriefingScheduleDefaults(null);
  assert.equal(template.template, 'daily_briefing');
  assert.deepEqual(template.cadence, { kind: 'daily', time: '08:00' });
  assert.equal(template.options.baziChartId, null);
  const bound = dailyBriefingScheduleDefaults('22222222-2222-4222-8222-222222222222');
  for (const prompt of [template.prompt, bound.prompt]) {
    assert.doesNotMatch(prompt, /almanac|current_time|read_user_data|bazi_chart|\{\{|工具|ID|时区/u);
    assert.match(prompt, /今天的运势早报/u);
  }
  assert.match(bound.prompt, /绑定命盘/u);
  assert.doesNotMatch(bound.prompt, /22222222-2222-4222-8222-222222222222/u);
});

type SettleCall = { runId: string; status: string; values: Record<string, unknown> };

function scheduleFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: 'user-1',
    name: '晨间整理',
    template: 'custom',
    prompt: '整理 {{date}}（{{weekday}}）的重点。',
    cadence: { kind: 'daily', time: '08:00' },
    timezone: 'Asia/Shanghai',
    conversation_id: '44444444-4444-4444-8444-444444444444',
    options: {
      model: 'fixture', reasoning: false, reasoningEffort: null, webEnabled: false,
      knowledgeBaseIds: [], baziChartId: null, collaborators: [], notify: true,
    },
    enabled: true,
    next_run_at: '2026-10-29T00:00:00Z',
    last_run_at: null,
    last_status: null,
    consecutive_failures: 0,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function mockScheduleDb(
  schedule: Record<string, unknown>,
  settled: SettleCall[],
  claims: Record<string, unknown>[],
  options: { agentRunStatus?: string; order?: string[]; createError?: Error } = {},
) {
  return {
    scope: { kind: 'system' },
    tx: async (work: (trx: unknown) => Promise<unknown>) => work({
      selectFrom(table: string) {
        const query: Record<string, unknown> = {
          select() { return query; }, selectAll() { return query; }, where() { return query; },
          orderBy() { return query; }, limit() { return query; },
          async executeTakeFirst() {
            if (table === 'agent_schedules') return schedule;
            if (table === 'agent_runs' && options.agentRunStatus) return { status: options.agentRunStatus };
            return undefined;
          },
          async execute() { return []; },
        };
        return query;
      },
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'enforce_agent_schedule_limits') return 0;
      if (name === 'claim_agent_schedules') return claims;
      if (name === 'create_agent_schedule_run') {
        options.order?.push('create');
        if (options.createError) throw options.createError;
        return { ...claimFixture(), id: '66666666-6666-4666-8666-666666666666', schedule_id: args.p_schedule_id, status: 'pending' };
      }
      if (name === 'settle_agent_schedule_run') {
        options.order?.push(`settle:${String(args.p_status)}`);
        settled.push({ runId: String(args.p_run_id), status: String(args.p_status), values: args });
        return { id: args.p_run_id, status: args.p_status };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  } as unknown as ScopedDb;
}

function claimFixture() {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    schedule_id: '33333333-3333-4333-8333-333333333333',
    user_id: 'user-1',
    scheduled_for: '2026-10-29T00:00:00Z',
    status: 'pending',
    skip_reason: null,
    agent_run_id: null,
    error: null,
    created_at: '2026-10-29T00:00:01Z',
    started_at: null,
    finished_at: null,
  };
}

function mockRuntime(
  t: TestContext,
  options: { balance?: number; free?: boolean; features?: 'enabled' | 'disabled'; modelAllowed?: boolean; submitError?: Error } = {},
  order?: string[],
) {
  t.mock.reset();
  const appSettings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const billing = require('../lib/billing/account.server') as typeof import('../lib/billing/account.server');
  const aiConfig = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  const submit = require('../lib/agent/submit.server') as typeof import('../lib/agent/submit.server');
  const submitted: Array<{ body: unknown; origin: string; runId?: string }> = [];
  const price = options.free ? 0 : 1;
  const model = { id: 'fixture', name: 'fixture', pricing: { input: price, output: price, cacheRead: null, cacheWrite: null, image: null } };
  t.mock.method(appSettings, 'getAgentScheduleLimits', async () => ({ limit: 20 }));
  t.mock.method(appSettings, 'readFeatureModuleStateFresh', async () => ({ status: options.features ?? 'enabled' } as never));
  t.mock.method(billing, 'getSpendableMicros', async () => options.balance ?? 1_000_000);
  t.mock.method(aiConfig, 'getModelConfigAsync', async () => options.modelAllowed === false ? null : (model as never));
  t.mock.method(aiConfig, 'getDefaultModelConfigAsync', async () => model as never);
  t.mock.method(submit, 'submitAgentTask', async (_ctx: unknown, body: unknown, origin: string, runtime: { runId?: string } = {}) => {
    order?.push('submit');
    submitted.push({ body, origin, runId: runtime.runId });
    if (options.submitError) throw options.submitError;
    return { id: runtime.runId } as AgentRunRow;
  });
  return { submitted };
}

test('a due occurrence submits the expanded prompt into the bound conversation and marks the run running', async (t) => {
  const settled: SettleCall[] = [];
  const order: string[] = [];
  const db = mockScheduleDb(scheduleFixture(), settled, [claimFixture()], { order });
  const runtime = mockRuntime(t, {}, order);
  const { processAgentSchedules } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
  const summary = await processAgentSchedules({ db });
  assert.deepEqual(summary, { claimed: 1, submitted: 1, skipped: 0, failed: 0 });
  // agent_schedule_runs.agent_run_id references agent_runs, so the run is created
  // before the occurrence is linked and marked running.
  assert.deepEqual(order, ['submit', 'settle:running']);
  assert.equal(runtime.submitted.length, 1);
  const call = runtime.submitted[0];
  assert.equal(call.origin, 'schedule');
  const body = call.body as { conversationId: string; clientRequestId: string; message: { content: string }; model?: string; webEnabled: boolean };
  assert.equal(body.conversationId, '44444444-4444-4444-8444-444444444444');
  assert.equal(body.clientRequestId, 'schedule:55555555-5555-4555-8555-555555555555');
  assert.equal(body.message.content, '整理 2026-10-29（周四）的重点。');
  assert.equal(body.model, 'fixture');
  assert.equal(body.webEnabled, false);
  assert.equal(call.runId, settled[0].values.p_agent_run_id);
  assert.deepEqual(settled.map(item => item.status), ['running']);
});

test('a run the worker finishes before the link commits is settled from its status', async (t) => {
  const settled: SettleCall[] = [];
  const db = mockScheduleDb(scheduleFixture(), settled, [claimFixture()], { agentRunStatus: 'completed' });
  const runtime = mockRuntime(t);
  const { processAgentSchedules } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
  assert.deepEqual(await processAgentSchedules({ db }), { claimed: 1, submitted: 1, skipped: 0, failed: 0 });
  assert.deepEqual(settled.map(item => item.status), ['running', 'completed']);
  const runId = runtime.submitted[0].runId;
  assert.deepEqual(settled.map(item => item.values.p_agent_run_id), [runId, runId]);
  assert.equal(settled[1].values.p_error, null);
});

test('a member without balance skips the occurrence and writes the reason; a free model still runs', async (t) => {
  const settled: SettleCall[] = [];
  const db = mockScheduleDb(scheduleFixture(), settled, [claimFixture()]);
  const runtime = mockRuntime(t, { balance: 0 });
  const { processAgentSchedules } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
  assert.deepEqual(await processAgentSchedules({ db }), { claimed: 1, submitted: 0, skipped: 1, failed: 0 });
  assert.equal(runtime.submitted.length, 0);
  assert.deepEqual(settled.map(item => item.status), ['skipped']);
  assert.equal(settled[0].values.p_skip_reason, 'insufficient_balance');

  const freeSettled: SettleCall[] = [];
  const free = mockRuntime(t, { balance: 0, free: true });
  assert.deepEqual(await processAgentSchedules({ db: mockScheduleDb(scheduleFixture(), freeSettled, [claimFixture()]) }), { claimed: 1, submitted: 1, skipped: 0, failed: 0 });
  assert.equal(free.submitted.length, 1);
});

test('a closed feature or a model the member cannot use also skips instead of failing', async (t) => {
  for (const [runtimeOptions, reason] of [[{ features: 'disabled' as const }, 'feature_disabled'], [{ modelAllowed: false }, 'model_unavailable']] as const) {
    const settled: SettleCall[] = [];
    const db = mockScheduleDb(scheduleFixture(), settled, [claimFixture()]);
    const runtime = mockRuntime(t, runtimeOptions);
    const { processAgentSchedules } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
    assert.deepEqual(await processAgentSchedules({ db }), { claimed: 1, submitted: 0, skipped: 1, failed: 0 });
    assert.equal(runtime.submitted.length, 0);
    assert.equal(settled[0].values.p_skip_reason, reason);
  }
});

test('a submit-time balance or pricing refusal is classified as a skip', async (t) => {
  for (const [code, reason] of [['INSUFFICIENT_BALANCE', 'insufficient_balance'], ['MODEL_UNPRICED', 'model_unavailable'], ['PROFILE_UNAVAILABLE', 'model_unavailable']] as const) {
    const settled: SettleCall[] = [];
    const db = mockScheduleDb(scheduleFixture(), settled, [claimFixture()]);
    const submit = require('../lib/agent/submit.server') as typeof import('../lib/agent/submit.server');
    mockRuntime(t, { submitError: new submit.AgentApiError('refused', 403, code) });
    const { processAgentSchedules } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
    assert.deepEqual(await processAgentSchedules({ db }), { claimed: 1, submitted: 0, skipped: 1, failed: 0 });
    // Nothing was linked yet: the refusal settles the pending occurrence directly.
    assert.deepEqual(settled.map(item => item.status), ['skipped']);
    assert.equal(settled[0].values.p_skip_reason, reason);
  }
});

const OWN_REF = 'byok:00000000-0000-4000-8000-0000000000b1';
const ownModel = (serverKey: boolean) => ({
  id: '00000000-0000-4000-8000-0000000000b1', ref: OWN_REF, modelId: 'deepseek-chat', displayName: 'DeepSeek', usage: 'chat' as const,
  supportsVision: false, thinkingLevels: [], defaultEffort: 'auto' as const, contextWindow: null, maxOutput: null,
  connection: { id: '00000000-0000-4000-8000-0000000000c1', name: 'DeepSeek', protocol: 'openai' as const, baseUrl: 'https://api.deepseek.com', keyHint: serverKey ? 'sk-…ored' : null, updatedAt: '2026-10-01T00:00:00Z' },
  serverKey, openKey: () => (serverKey ? 'sk-stored' : null),
});

test('an own model runs on schedule only with its key stored here; otherwise the occurrence is skipped and says why', async (t) => {
  const cases = [
    { model: ownModel(true), byok: 'enabled', submitted: true },
    { model: ownModel(false), byok: 'enabled', submitted: false },
    { model: null, byok: 'enabled', submitted: false },
    { model: ownModel(true), byok: 'disabled', submitted: false },
  ] as const;
  for (const { model, byok, submitted } of cases) {
    const settled: SettleCall[] = [];
    const schedule = scheduleFixture({ options: { ...scheduleFixture().options, model: OWN_REF } });
    const db = mockScheduleDb(schedule, settled, [claimFixture()]);
    const runtime = mockRuntime(t, { balance: 0 });
    const appSettings = require('../lib/app-settings') as typeof import('../lib/app-settings');
    const store = require('../lib/byok/store.server') as typeof import('../lib/byok/store.server');
    t.mock.method(appSettings, 'readFeatureModuleStateFresh', async (id: string) => ({ status: id === 'byok' ? byok : 'enabled' }) as never);
    t.mock.method(appSettings, 'getByokPolicy', async () => ({ allowServerKeys: true, maxConnections: 10, maxModelsPerConnection: 50 }));
    t.mock.method(store, 'resolveByokModel', async () => model as never);
    const { processAgentSchedules } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
    const summary = await processAgentSchedules({ db });
    const label = `${model ? (model.serverKey ? 'stored' : 'browser') : 'missing'} key, byok ${byok}`;
    assert.equal(runtime.submitted.length, submitted ? 1 : 0, label);
    if (submitted) {
      assert.equal((runtime.submitted[0].body as { model: string }).model, OWN_REF, 'no balance needed for an own model');
      continue;
    }
    assert.deepEqual(summary, { claimed: 1, submitted: 0, skipped: 1, failed: 0 }, label);
    assert.equal(settled[0].values.p_skip_reason, 'model_unavailable', label);
    assert.match(String(settled[0].values.p_error), /Key 没有保存到本站/u, label);
  }
});

test('a submit-time refusal of an own model or its key is a skip with the reason the member reads', async (t) => {
  for (const code of ['BYOK_UNAVAILABLE', 'BYOK_KEY_UNAVAILABLE'] as const) {
    const settled: SettleCall[] = [];
    const db = mockScheduleDb(scheduleFixture(), settled, [claimFixture()]);
    const submit = require('../lib/agent/submit.server') as typeof import('../lib/agent/submit.server');
    mockRuntime(t, { submitError: new submit.AgentApiError('refused', 400, code) });
    const { processAgentSchedules } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
    assert.deepEqual(await processAgentSchedules({ db }), { claimed: 1, submitted: 0, skipped: 1, failed: 0 });
    assert.equal(settled[0].values.p_skip_reason, 'model_unavailable');
    assert.match(String(settled[0].values.p_error), /自定义模型不可用/u);
  }
});

test('manual run creates its occurrence through the SQL function, then submits', async (t) => {
  const settled: SettleCall[] = [];
  const order: string[] = [];
  const db = mockScheduleDb(scheduleFixture(), settled, [], { order });
  const runtime = mockRuntime(t, {}, order);
  const { runAgentScheduleNow } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
  const run = await runAgentScheduleNow('user-1', '33333333-3333-4333-8333-333333333333', db);
  // The schedule tables are owner-only under RLS, so the row comes from the definer function.
  assert.deepEqual(order, ['create', 'submit', 'settle:running']);
  assert.equal(run.id, '66666666-6666-4666-8666-666666666666');
  assert.equal(runtime.submitted.length, 1);
  assert.equal(settled[0].values.p_agent_run_id, runtime.submitted[0].runId);
});

test('manual run refuses to stack and reports the busy occurrence', async (t) => {
  const db = mockScheduleDb(scheduleFixture(), [], [], { createError: new Error('AGENT_SCHEDULE_RUN_BUSY') });
  mockRuntime(t);
  const { runAgentScheduleNow } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
  const { AgentScheduleError } = require('../lib/agent/schedules/server') as typeof import('../lib/agent/schedules/server');
  await assert.rejects(
    runAgentScheduleNow('user-1', '33333333-3333-4333-8333-333333333333', db),
    (error: unknown) => error instanceof AgentScheduleError && error.status === 409 && error.code === 'AGENT_SCHEDULE_RUN_BUSY',
  );
});
