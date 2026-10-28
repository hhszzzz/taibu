import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { ScopedDb } from '../lib/db/context.server';
import type { AgentRunRow } from '../lib/agent/store.server';
import {
  agentScheduleLocalParts, dailyBriefingScheduleDefaults, expandAgentSchedulePrompt,
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
  assert.deepEqual(normalizeAgentScheduleLimits({ free: '0', plus: 8, pro: 500 }), { free: 0, plus: 8, pro: 20 });
  assert.deepEqual(normalizeAgentScheduleLimits('bad'), { free: 1, plus: 5, pro: 20 });
});

test('prompt variables read the occurrence instant in the schedule zone, not the wall clock', () => {
  const content = expandAgentSchedulePrompt('{{date}} {{weekday}} {{time}} {{timezone}} {{name}} {{unknown}}', {
    scheduledFor: '2026-10-29T00:00:00Z', timezone: 'Asia/Shanghai', name: '早报',
  });
  assert.equal(content, '2026-10-29 周四 08:00 Asia/Shanghai 早报 {{unknown}}');
  assert.deepEqual(agentScheduleLocalParts(new Date('2026-03-08T04:30:00Z'), 'America/New_York'), { date: '2026-03-07', time: '23:30', weekday: '周六' });
});

test('the daily briefing template binds the default chart and runs at eight local time', () => {
  const template = dailyBriefingScheduleDefaults(null);
  assert.equal(template.template, 'daily_briefing');
  assert.deepEqual(template.cadence, { kind: 'daily', time: '08:00' });
  assert.equal(template.options.baziChartId, null);
  assert.match(template.prompt, /almanac/);
  assert.match(template.prompt, /用户默认命盘/);
  const bound = dailyBriefingScheduleDefaults('22222222-2222-4222-8222-222222222222');
  assert.match(bound.prompt, /22222222-2222-4222-8222-222222222222/);
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

function mockScheduleDb(schedule: Record<string, unknown>, settled: SettleCall[], claims: Record<string, unknown>[]) {
  return {
    scope: { kind: 'system' },
    tx: async (work: (trx: unknown) => Promise<unknown>) => work({
      selectFrom(table: string) {
        const query: Record<string, unknown> = {
          select() { return query; }, selectAll() { return query; }, where() { return query; },
          orderBy() { return query; }, limit() { return query; },
          async executeTakeFirst() { return table === 'agent_schedules' ? schedule : undefined; },
          async execute() { return []; },
        };
        return query;
      },
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'enforce_agent_schedule_limits') return 0;
      if (name === 'claim_agent_schedules') return claims;
      if (name === 'settle_agent_schedule_run') {
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

function mockRuntime(t: TestContext, options: { credits?: number; features?: 'enabled' | 'disabled'; modelAllowed?: boolean; submitError?: Error } = {}) {
  t.mock.reset();
  const appSettings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
  const aiConfig = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  const submit = require('../lib/agent/submit.server') as typeof import('../lib/agent/submit.server');
  const submitted: Array<{ body: unknown; origin: string; runId?: string }> = [];
  t.mock.method(appSettings, 'getAgentScheduleLimits', async () => ({ free: 1, plus: 5, pro: 20 }));
  t.mock.method(appSettings, 'readFeatureModuleStateFresh', async () => ({ status: options.features ?? 'enabled' } as never));
  t.mock.method(credits, 'getUserCreditInfo', async () => ({ credits: options.credits ?? 5, membership: 'plus' as const, expiresAt: null }));
  t.mock.method(aiConfig, 'getModelConfigAsync', async () => options.modelAllowed === false ? null : ({ id: 'fixture', name: 'fixture', requiredTier: 'free' } as never));
  t.mock.method(aiConfig, 'getDefaultModelConfigAsync', async () => ({ id: 'fixture', name: 'fixture', requiredTier: 'free' } as never));
  t.mock.method(submit, 'submitAgentTask', async (_ctx: unknown, body: unknown, origin: string, runtime: { runId?: string } = {}) => {
    submitted.push({ body, origin, runId: runtime.runId });
    if (options.submitError) throw options.submitError;
    return { id: runtime.runId } as AgentRunRow;
  });
  return { submitted };
}

test('a due occurrence submits the expanded prompt into the bound conversation and marks the run running', async (t) => {
  const settled: SettleCall[] = [];
  const db = mockScheduleDb(scheduleFixture(), settled, [claimFixture()]);
  const runtime = mockRuntime(t);
  const { processAgentSchedules } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
  const summary = await processAgentSchedules({ db });
  assert.deepEqual(summary, { claimed: 1, submitted: 1, skipped: 0, failed: 0 });
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

test('a member without credits skips the occurrence and writes the reason', async (t) => {
  const settled: SettleCall[] = [];
  const db = mockScheduleDb(scheduleFixture(), settled, [claimFixture()]);
  const runtime = mockRuntime(t, { credits: 0 });
  const { processAgentSchedules } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
  assert.deepEqual(await processAgentSchedules({ db }), { claimed: 1, submitted: 0, skipped: 1, failed: 0 });
  assert.equal(runtime.submitted.length, 0);
  assert.deepEqual(settled.map(item => item.status), ['skipped']);
  assert.equal(settled[0].values.p_skip_reason, 'insufficient_credits');
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

test('a submit-time credit or permission refusal is classified as a skip', async (t) => {
  for (const [code, reason] of [['INSUFFICIENT_CREDITS', 'insufficient_credits'], ['MEMBERSHIP_REQUIRED', 'model_unavailable']] as const) {
    const settled: SettleCall[] = [];
    const db = mockScheduleDb(scheduleFixture(), settled, [claimFixture()]);
    const submit = require('../lib/agent/submit.server') as typeof import('../lib/agent/submit.server');
    mockRuntime(t, { submitError: new submit.AgentApiError('refused', 403, code) });
    const { processAgentSchedules } = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
    assert.deepEqual(await processAgentSchedules({ db }), { claimed: 1, submitted: 0, skipped: 1, failed: 0 });
    assert.deepEqual(settled.map(item => item.status), ['running', 'skipped']);
    assert.equal(settled[1].values.p_skip_reason, reason);
  }
});
