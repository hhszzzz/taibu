import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AgentToolPart } from '../lib/agent/tool-presentation';
import { getAgentChart } from '../lib/agent/tool-presentation';
import { getAgentChartReference, getChartTargets, getDrilldownFocus, getDrilldownTargets } from '../lib/agent/chart-interaction';
import { getAgentDrilldownBase } from '../lib/agent/tool-catalog';
import { createAgentTools } from '../lib/agent/tools.server';
import { buildAgentWorkspace } from '../lib/agent/workspace';
import { describeDrilldownSelection } from '../components/chat/agent/presentation';
import type { AgentRunRow } from '../lib/agent/store.server';
import { MemoryStore, row } from './helpers/agent-runtime-fixture';

const birth = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };

beforeEach(t => {
  assert.ok('mock' in t);
  t.mock.method(require('../lib/user/credits'), 'getUserCreditInfo', async () => ({ membership: 'plus', credits: 10, expiresAt: null }));
  t.mock.method(require('../lib/app-settings'), 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' }));
});

class ChartStore extends MemoryStore {
  override async chartArtifact(_run: AgentRunRow, id: string) {
    return [...this.drafts.values()].find(artifact => artifact.kind === 'calculation' && artifact.id === id) ?? null;
  }
  override async inspectedChart(_run: AgentRunRow, reference: string) {
    return [...this.drafts.values()].reverse().find(artifact => (artifact.tool_name === 'inspect_chart' || getAgentDrilldownBase(artifact.tool_name))
      && (artifact.result.details as { chartReference?: string }).chartReference === reference) ?? null;
  }
}

async function setup() {
  const store = new ChartStore(), run = row();
  const tools = await createAgentTools(store, run, run.checkpoint);
  const tool = (name: string) => tools.find(item => item.name === name)!;
  await tool('bazi').execute('calculate', birth);
  return { store, run, tools, tool, reference: 'artifact:' + store.draft('calculate')!.id };
}

type DrilldownDetails = { chartReference: string; chartKind: string; selection: Record<string, unknown>; result: Record<string, unknown>; targets: Array<{ id: string; label: string }> };

test('the Agent schema of a drilldown takes a chart reference and selectors, never birth data', async () => {
  const { tool } = await setup();
  const parameters = tool('bazi_relations').parameters as unknown as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
  assert.deepEqual(Object.keys(parameters.properties).sort(), ['day', 'dayun', 'month', 'reference', 'year', 'yunSect']);
  assert.deepEqual(parameters.required, ['reference']);
  assert.equal(parameters.additionalProperties, false);
});

test('a drilldown recomputes the artifact chart, caches as a tool call and counts as an inspection for focus', async () => {
  const { store, tool, reference } = await setup();
  const result = await tool('bazi_relations').execute('5:relations', { reference: reference.toUpperCase().replace('ARTIFACT', 'artifact'), year: 2027 });
  const details = result.details as DrilldownDetails;
  assert.equal(details.chartReference, reference);
  assert.equal(details.chartKind, 'bazi');
  assert.deepEqual(details.selection, { year: 2027 });
  assert.ok(Array.isArray(details.result.叠加关系));
  assert.match(result.content[0].text, /# 八字刑冲合害详查/);
  // Targets name only real cells of the chart, at most 16, and the model sees them.
  const chart = getAgentChart({ type: 'tool', id: 'c', name: 'bazi', title: 'bazi', status: 'completed', output: store.draft('calculate')!.result.details })!;
  const known = new Set(getChartTargets(chart).map(target => target.id));
  assert.ok(details.targets.length > 0 && details.targets.length <= 16 && details.targets.every(target => known.has(target.id)));
  assert.deepEqual(JSON.parse(result.content[1].text).targets, details.targets);
  const write = store.writes.find(item => item.name === 'agent_cache_tool' && item.args.p_tool_name === 'bazi_relations')!;
  assert.equal(write.args.p_kind, 'tool', 'a drilldown is not a new result');
  assert.equal(write.args.p_chart, null);
  assert.equal((write.args.p_result as { inspectionOrder?: number }).inspectionOrder, 5);
  // focus_chart accepts the drilldown's targets without a separate inspect_chart.
  const focus = await tool('focus_chart').execute('6:focus', { reference, targetIds: details.targets.map(target => target.id), caption: '流年关系' });
  assert.deepEqual((focus.details as { chartFocus: { targetIds: string[] } }).chartFocus.targetIds, details.targets.map(target => target.id));
});

test('drilldowns reject charts of another system, tampered artifacts and unknown references', async () => {
  const { store, tool, reference } = await setup();
  await tool('ziwei').execute('ziwei', birth);
  const ziwei = 'artifact:' + store.draft('ziwei')!.id;
  await assert.rejects(tool('bazi_relations').execute('r1', { reference: ziwei }), /只适用于八字命盘/);
  await assert.rejects(tool('bazi_relations').execute('r2', { reference: 'artifact:' + randomUUID() }), /不在当前会话|无权访问/);
  const artifact = store.draft('calculate')!;
  artifact.args = { ...artifact.args, birthHour: 21 };
  await assert.rejects(tool('bazi_relations').execute('r3', { reference }), /命盘算法已更新或时间无法还原/);
});

test('a saved birth record is rebuilt from its stored fields', async t => {
  const store = new ChartStore(), run = row(), id = randomUUID();
  const record = { id, gender: 'male', birth_date: '1990-01-15', birth_time: '09:00', timezone: 'Asia/Shanghai', calendar_type: 'solar' };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id }, error: null }) };
  Object.assign(store.db, { from: () => query });
  t.mock.method(require('../lib/data-sources'), 'getProvider', async () => ({ get: async () => record, formatForAI: async () => '' }));
  const tools = await createAgentTools(store, run, run.checkpoint);
  const result = await tools.find(item => item.name === 'bazi_relations')!.execute('saved', { reference: 'bazi_chart:' + id });
  const details = result.details as DrilldownDetails;
  assert.deepEqual((details.result.参与柱位 as Array<{ 干支: string }>).map(pillar => pillar.干支), ['己巳', '丁丑', '庚辰', '辛巳']);
  assert.equal(details.chartReference, 'bazi_chart:' + id);
});

test('Core calculations honour the requested detail level', async () => {
  const { tool } = await setup();
  const plain = await tool('bazi_dayun').execute('dayun-default', birth);
  const full = await tool('bazi_dayun').execute('dayun-full', { ...birth, detailLevel: 'full' });
  assert.doesNotMatch(plain.content[0].text, /## 小运/);
  assert.match(full.content[0].text, /## 小运/);
  assert.ok(((full.details as { result: { 大运列表: Array<{ 流年列表?: unknown[] }> } }).result.大运列表[0].流年列表 ?? []).length > 0);
});

test('the workspace keeps drilldowns under their chart and they never replace its reading', async () => {
  const { store, tool, reference } = await setup();
  const result = await tool('bazi_relations').execute('relations', { reference, year: 2027, month: 5 });
  const calculation: AgentToolPart = { type: 'tool', id: 'calculate', name: 'bazi', title: '八字命盘', status: 'completed', output: { artifactId: store.draft('calculate')!.id, result: store.draft('calculate')!.result.details } };
  const drilldown: AgentToolPart = { type: 'tool', id: 'relations', name: 'bazi_relations', title: '八字刑冲合害', status: 'completed', input: { reference, year: 2027, month: 5 }, output: result.details };
  const pending: AgentToolPart = { ...drilldown, id: 'pending', status: 'running', output: undefined };
  assert.equal(getAgentChart(drilldown), null);
  assert.equal(getAgentChartReference(drilldown), reference);
  const model = buildAgentWorkspace({ parts: [calculation, drilldown, pending], artifacts: [], attachmentIds: [] });
  assert.equal(model.resources.length, 1);
  assert.deepEqual(model.resources[0].toolIds, ['calculate', 'relations', 'pending']);
  assert.equal(model.resources[0].view, 'chart');
  const focus = getDrilldownFocus(drilldown)!;
  assert.equal(focus.reference, reference);
  assert.deepEqual(focus.targetIds, (result.details as DrilldownDetails).targets.map(target => target.id));
  assert.equal(getDrilldownFocus(pending), null);
  // A drilldown of a chart this task never showed opens that chart's tab by itself.
  const alone = buildAgentWorkspace({ parts: [drilldown], artifacts: [], attachmentIds: [] });
  assert.equal(alone.resources[0].title, '八字命盘');
  assert.equal(alone.chartResources.get(reference), alone.resources[0].id);
  assert.equal(describeDrilldownSelection({ reference, year: 2027, month: 5 }), '2027 年 · 5 月（节气月）');
  assert.equal(describeDrilldownSelection({ reference }), '原局');
  const chart = getAgentChart(calculation)!;
  assert.deepEqual(getDrilldownTargets(chart, { 原局关系: [{ 位置: [{ 柱: '月柱', 部位: '地支', 字: '丑' }, { 柱: '流年', 部位: '地支', 字: '未' }] }] }).map(target => target.id), ['bazi:cell:1:1']);
});
