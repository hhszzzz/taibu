import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import { getCurrentTools, type JsonObject } from '@earendil-works/pi-ai';
import { listToolDefinitions } from 'taibu-core/mcp';
import type { AgentRunRow } from '../lib/agent/store.server';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { findSavedAgentChart, getAgentChartSave, getSavedChartHref } from '../lib/agent/chart-save';
import type { UserChartBundle, UserChartRecord } from '../lib/user/charts-client';
import { config, MemoryStore, row, scripted } from './helpers/agent-runtime-fixture';

beforeEach((t) => {
  assert.ok('mock' in t);
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const sdk = require('../lib/ai/providers/ai-sdk-provider') as typeof import('../lib/ai/providers/ai-sdk-provider');
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
  t.mock.method(sdk, 'isModelAvailable', () => true);
  t.mock.method(sdk, 'createModelFromConfig', () => new MockLanguageModelV3());
});

const finished = (store: MemoryStore) => store.writes.filter(write => write.name === 'agent_finish_run').at(-1)!;
const bazi = (): JsonObject => ({ ...(listToolDefinitions().find(definition => definition.name === 'bazi')!.inputSchema.examples![0] as JsonObject) });
const completed = (name: string, input: Record<string, unknown>) => ({ name, status: 'completed', input });
const args = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
const record = (overrides: Partial<UserChartRecord>): UserChartRecord => ({
  id: 'saved', name: '张三', gender: 'male', birth_date: '1990-01-15', birth_time: '09:00:00', birth_place: null, longitude: null,
  calendar_type: 'solar', is_leap_month: false, created_at: '2026-10-20T00:00:00Z', timezone: 'Asia/Shanghai', disambiguation: 'reject', ...overrides,
});
const library = (baziCharts: UserChartRecord[], ziweiCharts: UserChartRecord[] = []): UserChartBundle => ({ baziCharts, ziweiCharts, defaultChartIds: { bazi: null, ziwei: null } });

test('a chart settles with the answer: no selection tool, nothing saved, the reference reaches the model', async () => {
  const store = new MemoryStore(), run = row();
  const offered: string[][] = [];
  const results: string[] = [];
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'chart', name: 'bazi', arguments: bazi() }];
    return [{ type: 'text', text: '日主庚金，取财官。' }];
  }, messages => {
    offered.push(getCurrentTools(messages).map(tool => tool.name));
    for (const message of messages) if (message.role === 'toolResult' && message.toolName === 'bazi')
      results.push(message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n'));
  }) });
  const finish = finished(store);
  assert.equal(finish.args.p_status, 'completed');
  assert.ok(offered.every(names => !names.includes('select_final_artifacts')));
  assert.deepEqual(Object.keys(finish.args).sort(), ['p_checkpoint', 'p_fence', 'p_message', 'p_run_id', 'p_status', 'p_worker_id']);
  const checkpoint = finish.args.p_checkpoint as Record<string, unknown>;
  for (const key of ['finalArtifacts', 'finalSelectionMade', 'finalNudges']) assert.equal(key in checkpoint, false, key);
  const [cached] = store.calculations();
  assert.ok(results.at(-1)?.includes(`命盘引用: artifact:${cached.id}`), 'the model can inspect the chart by reference');
  assert.equal('p_chart' in store.writes.find(write => write.name === 'agent_cache_tool')!.args, false);
  assert.equal(((finish.args.p_message as AgentRunRow['public_message']).agent?.parts ?? []).some(part => part.type === 'artifact'), false);
});

test('an agent call with a Gregorian date reaches Core despite schema defaults', async () => {
  const store = new MemoryStore(), run = row();
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'divine', name: 'xiaoliuren', arguments: { date: '2026-02-14', hour: 9, question: '今日运势' } }];
    return [{ type: 'text', text: '起课为大安。' }];
  }) });
  const finish = finished(store);
  assert.equal(finish.args.p_status, 'completed', (finish.args.p_message as AgentRunRow['public_message']).agent?.error);
  const part = ((finish.args.p_message as AgentRunRow['public_message']).agent?.parts ?? []).find(item => item.type === 'tool' && item.name === 'xiaoliuren');
  assert.equal(part?.type === 'tool' && part.status, 'completed');
});

test('bazi and ziwei calculations become the payload the result pages save', () => {
  assert.deepEqual(getAgentChartSave(completed('bazi', { ...args, birthMinute: 5, birthPlace: ' 北京 ', longitude: 116.4 })), {
    type: 'bazi',
    payload: {
      name: '男命 1990-01-15', gender: 'male', birth_date: '1990-01-15', birth_time: '09:05', calendar_type: 'solar', is_leap_month: false,
      birth_place: '北京', longitude: 116.4, timezone: 'Asia/Shanghai', disambiguation: 'reject',
    },
  });
  assert.equal(getAgentChartSave(completed('ziwei', { ...args, gender: 'female', calendarType: 'lunar', isLeapMonth: true }))?.payload.name, '女命 1990-01-15');
  assert.equal(getAgentChartSave(completed('bazi', { ...args, timezone: 'America/New_York', disambiguation: 'later' }))?.payload.timezone, 'America/New_York');
  assert.equal(getAgentChartSave(completed('bazi', { ...args, dayBoundary: 'midnight' }))?.type, 'bazi');
  for (const input of [
    { ...args, dayBoundary: 'zi' }, { ...args, timezone: 'invalid/timezone' }, { ...args, disambiguation: 'invalid' },
    { ...args, birthMonth: 2, birthDay: 30, calendarType: 'lunar' }, { ...args, gender: 'other' }, { ...args, birthHour: 9.5 },
  ]) assert.equal(getAgentChartSave(completed('bazi', input)), null, JSON.stringify(input));
  assert.equal(getAgentChartSave(completed('ziwei', { ...args, calculationOptions: { algorithm: 'zhongzhou' } })), null);
  assert.equal(getAgentChartSave(completed('liuyao', args)), null, 'only bazi and ziwei have chart tables');
  assert.equal(getAgentChartSave({ name: 'bazi', status: 'running', input: args }), null);
});

test('a chart counts as saved when the library holds the same birth identity, whatever its name or page', () => {
  const save = getAgentChartSave(completed('bazi', args))!;
  assert.equal(findSavedAgentChart(library([record({})]), save)?.id, 'saved', 'stored times carry seconds');
  assert.equal(findSavedAgentChart(library([record({ name: '另一个名字', birth_place: '上海' })]), save)?.id, 'saved');
  assert.equal(findSavedAgentChart(library([record({ timezone: undefined, disambiguation: undefined })]), save)?.id, 'saved', 'missing rules read as the defaults');
  for (const different of [{ birth_time: '10:00:00' }, { gender: 'female' as const }, { calendar_type: 'lunar' }, { is_leap_month: true }, { longitude: 120 }, { timezone: 'UTC' }, { disambiguation: 'later' as const }])
    assert.equal(findSavedAgentChart(library([record(different)]), save), null, JSON.stringify(different));
  assert.equal(findSavedAgentChart(library([], [record({})]), save), null, 'a ziwei chart is not the bazi chart');
  assert.equal(findSavedAgentChart(undefined, save), null);
  assert.equal(getSavedChartHref('ziwei', 'a/b'), '/ziwei/result?chart=a%2Fb');
});
