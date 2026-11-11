import { test, beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AgentToolPart } from '../lib/agent/tool-presentation';
import { getAgentChart } from '../lib/agent/tool-presentation';
import { getAgentChartReference, getChartTargets, getDrilldownFocus, getDrilldownTargets, getLatestChartFocus } from '../lib/agent/chart-interaction';
import { createAgentTools } from '../lib/agent/tools.server';
import { buildAgentWorkspace } from '../lib/agent/workspace';
import { describeDrilldownSelection } from '../components/chat/agent/presentation';
import { publicCanonicalText } from '../lib/agent/durable-projection.server';
import { agentDrilldownCiteNote } from '../lib/agent/tool-catalog';
import { MemoryStore, row } from './helpers/agent-runtime-fixture';
import { createMockScopedDb } from './helpers/db-mock';

const birth = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };

beforeEach(t => {
  assert.ok('mock' in t);
  t.mock.method(require('../lib/app-settings'), 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' }));
});

async function setup() {
  const store = new MemoryStore(), run = row();
  const tools = await createAgentTools(store, run, run.checkpoint);
  const tool = (name: string) => tools.find(item => item.name === name)!;
  await tool('bazi').execute('calculate', birth);
  return { store, run, tools, tool, reference: 'artifact:' + store.draft('calculate')!.id };
}

function mockChartOwnership(t: Pick<TestContext, 'mock'>) {
  const context = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      selectFrom() {
        const query = {
          select() { return query; },
          where() { return query; },
          async executeTakeFirst() { return { id: 'owned' }; },
        };
        return query;
      },
    } as never),
  });
  t.mock.method(context, 'systemDb', () => scoped);
}

type DrilldownDetails = { chartReference: string; chartKind: string; selection: Record<string, unknown>; result: Record<string, unknown>; targets: Array<{ id: string; label: string }> };

test('the Agent schema of a drilldown takes a chart reference and selectors, never birth data', async () => {
  const { tool } = await setup();
  const parameters = tool('bazi_relations').parameters as unknown as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
  assert.deepEqual(Object.keys(parameters.properties).sort(), ['day', 'dayun', 'detailLevel', 'month', 'pillars', 'reference', 'types', 'year', 'yunSect']);
  assert.deepEqual(parameters.required, ['reference']);
  assert.equal(parameters.additionalProperties, false);
});

test('a drilldown recomputes the artifact chart, caches as a tool call and hands the workspace the positions it touched', async () => {
  const { store, tool, reference } = await setup();
  const result = await tool('bazi_relations').execute('5:relations', { reference: reference.toUpperCase().replace('ARTIFACT', 'artifact'), year: 2027 });
  const details = result.details as DrilldownDetails;
  assert.equal(details.chartReference, reference);
  assert.equal(details.chartKind, 'bazi');
  assert.deepEqual(details.selection, { year: 2027 });
  assert.ok(Array.isArray(details.result.叠加关系));
  assert.match(result.content[0].text, /# 八字岁运刑冲合害详查/);
  // Targets name only real cells of the chart, at most 16, and the model sees them.
  const chart = getAgentChart({ type: 'tool', id: 'c', name: 'bazi', title: 'bazi', status: 'completed', output: store.draft('calculate')!.result.details })!;
  const known = new Set(getChartTargets(chart).map(target => target.id));
  assert.ok(details.targets.length > 0 && details.targets.length <= 16 && details.targets.every(target => known.has(target.id)));
  // The model reads Core's text alone; the positions go to the workspace, not back to the model as JSON.
  assert.equal(result.content.length, 1);
  assert.doesNotMatch(result.content[0].text, /"targets"|artifact:|bazi:cell:/);
  const write = store.writes.find(item => item.name === 'agent_cache_tool' && item.args.p_tool_name === 'bazi_relations')!;
  assert.equal(write.args.p_kind, 'tool', 'a drilldown is not a new result');
  assert.deepEqual(Object.keys(write.args.p_result as object).sort(), ['canonicalText', 'content', 'details'], 'no snapshot of the chart rides along');
});

test('with numbered evidence the main agent\'s drilldown tells the model its number; members and scripts get none', async () => {
  const { run, tool, reference } = await setup();
  run.checkpoint.citations = { base: 4, calls: {} };
  const result = await tool('bazi_relations').execute('relations', { reference, year: 2027 });
  assert.deepEqual(result.content.slice(1), [{ type: 'text', text: agentDrilldownCiteNote(5) }]);
  assert.match(agentDrilldownCiteNote(5), /\[5\]/u, 'the note shows the marker to write');
  assert.equal((result.details as { cite?: number }).cite, 5);
  assert.deepEqual(run.checkpoint.citations, { base: 4, calls: { relations: 5 } });
  // The step shows Core's text; the number is written for the model only.
  assert.equal(publicCanonicalText('bazi_relations', result.content), result.canonicalText);
  // A replay returns and records the same number.
  assert.deepEqual(await tool('bazi_relations').execute('relations', { reference, year: 2027 }), result);
  assert.deepEqual(run.checkpoint.citations, { base: 4, calls: { relations: 5 } });
  // A member reports its own sources and a script returns only what it prints: neither is shown a number.
  for (const caller of [{ member: true }, { script: true }]) {
    const unnumbered = await tool('bazi_wuxing').execute(JSON.stringify(caller), { reference }, undefined, caller);
    assert.equal(unnumbered.content.length, 1);
    assert.equal((unnumbered.details as { cite?: number }).cite, undefined);
  }
  assert.deepEqual(run.checkpoint.citations, { base: 4, calls: { relations: 5 } });
  assert.equal(((await tool('bazi_wuxing').execute('wuxing', { reference })).details as { cite?: number }).cite, 6);
});

test('drilldown filters reach Core while detailLevel only adds the 口径 to the text the model reads', async () => {
  const { tool, reference } = await setup();
  const lean = await tool('bazi_relations').execute('lean', { reference, year: 2027, types: ['六冲'] });
  const leanDetails = lean.details as DrilldownDetails;
  assert.deepEqual(leanDetails.selection, { year: 2027, types: ['六冲'] });
  assert.deepEqual(leanDetails.result.筛选, { 类型: ['六冲'] });
  assert.ok((leanDetails.result.叠加关系 as Array<{ 类型: string }>).every(row => row.类型 === '六冲'));
  // The structured result keeps the rules; the default text leaves them out.
  assert.ok(Array.isArray(leanDetails.result.口径) && leanDetails.result.计算规则);
  assert.doesNotMatch(lean.content[0].text, /## 口径|## 计算规则/);
  assert.match(lean.content[0].text, /## 未列出/);
  const full = await tool('bazi_relations').execute('full', { reference, year: 2027, types: ['六冲'], detailLevel: 'full' });
  assert.match(full.content[0].text, /## 口径/);
  // 计算规则 is audit metadata: it stays in the structured result and never reaches the model's text.
  assert.doesNotMatch(full.content[0].text, /## 计算规则|ruleVersion/);
  assert.deepEqual((full.details as DrilldownDetails).result.叠加关系, leanDetails.result.叠加关系, 'detailLevel never changes the facts');
  // 原局关系在命盘里：不给岁运的查询直接拒绝；给了大运却筛流年时说明该补哪个参数。
  await assert.rejects(tool('bazi_relations').execute('natal', { reference }), /year；day；dayun/);
  await assert.rejects(tool('bazi_relations').execute('missing', { reference, dayun: 4, pillars: ['流年'] }), /查流年须同时给出 year 或 day/);
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
  mockChartOwnership(t);
  const store = new MemoryStore(), run = row(), id = randomUUID();
  const record = { id, gender: 'male', birth_date: '1990-01-15', birth_time: '09:00', timezone: 'Asia/Shanghai', calendar_type: 'solar' };
  t.mock.method(require('../lib/data-sources'), 'getProvider', async () => ({ get: async () => record, formatForAI: async () => '' }));
  const tools = await createAgentTools(store, run, run.checkpoint);
  const result = await tools.find(item => item.name === 'bazi_relations')!.execute('saved', { reference: 'bazi_chart:' + id, year: 2027 });
  const details = result.details as DrilldownDetails;
  assert.deepEqual((details.result.参与柱位 as Array<{ 干支: string }>).map(pillar => pillar.干支), ['己巳', '丁丑', '庚辰', '辛巳', '癸酉', '丁未']);
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
  // What the model is looking at follows its drilldowns: running names the step, completed shows its positions,
  // a failed one changes nothing; in an older conversation a later focus call took over.
  assert.deepEqual(getLatestChartFocus([calculation, pending], reference), { version: 1, reference, targetIds: [], includeRelated: false, caption: '详查中 · 八字刑冲合害' });
  assert.deepEqual(getLatestChartFocus([calculation, drilldown], reference), focus);
  assert.deepEqual(getLatestChartFocus([calculation, drilldown, { ...pending, status: 'failed' }], reference), focus);
  const later: AgentToolPart = { type: 'tool', id: 'focus', name: 'focus_chart', title: '定位', status: 'completed', output: { chartFocus: { version: 1, reference, targetIds: ['bazi:cell:2:1'], includeRelated: false, caption: '日支' } } };
  assert.equal(getLatestChartFocus([calculation, drilldown, later], reference)?.caption, '日支');
  assert.deepEqual(getLatestChartFocus([calculation, later, drilldown], reference), focus);
  const reading: AgentToolPart = { type: 'tool', id: 'read', name: 'inspect_chart', title: '查看命盘', status: 'running', input: { reference } };
  assert.equal(getLatestChartFocus([calculation, drilldown, reading], reference)?.caption, '读取整张盘');
  // A drilldown of a chart this task never showed opens that chart's tab by itself.
  const alone = buildAgentWorkspace({ parts: [drilldown], artifacts: [], attachmentIds: [] });
  assert.equal(alone.resources[0].title, '八字命盘');
  assert.equal(alone.chartResources.get(reference), alone.resources[0].id);
  assert.equal(describeDrilldownSelection({ reference, year: 2027, month: 5 }), '2027 年 · 5 月（节气月）');
  assert.equal(describeDrilldownSelection({ reference }), '原局');
  const chart = getAgentChart(calculation)!;
  assert.deepEqual(getDrilldownTargets(chart, { 叠加关系: [{ 位置: [{ 柱: '月柱', 部位: '地支', 字: '丑' }, { 柱: '流年', 部位: '地支', 字: '未' }] }] }).map(target => target.id), ['bazi:cell:1:1']);
});

test('a bazi relations drilldown lights the natal glyphs its overlays touch, never the linked ones', async () => {
  const { store, tool } = await setup();
  // 乙丑 辛巳 辛未 戊子，2027 丁未年行丙戌运：丙合两辛，未冲年支丑、害时支子，戌破日支未。
  const rich = { gender: 'female', birthYear: 1985, birthMonth: 6, birthDay: 1, birthHour: 0 };
  await tool('bazi').execute('rich', rich);
  const reference = 'artifact:' + store.draft('rich')!.id;
  const result = await tool('bazi_relations').execute('rich-relations', { reference, year: 2027 });
  const details = result.details as DrilldownDetails;
  assert.deepEqual(details.targets.map(target => target.id).sort(), ['bazi:cell:0:1', 'bazi:cell:1:0', 'bazi:cell:2:0', 'bazi:cell:2:1', 'bazi:cell:3:1']);
  // 原局之间的关系由命盘给出，详查不再点亮盘面的关系线。
  assert.ok(details.targets.every(target => target.id.startsWith('bazi:cell:')));
  // 筛选后的同字牵连只是提示，不点亮：只查六冲时，盘面只亮被冲的年支丑。
  const filtered = await tool('bazi_relations').execute('rich-clash', { reference, year: 2027, types: ['六冲'] });
  assert.deepEqual((filtered.details as DrilldownDetails).targets.map(target => target.label), ['年柱地支 丑']);
});

/** 排好一张盘，再对它做详查。 */
async function chartSetup(name: string, args: Record<string, unknown>) {
  const store = new MemoryStore(), run = row();
  const tools = await createAgentTools(store, run, run.checkpoint);
  await tools.find(item => item.name === name)!.execute('chart', args);
  return { store, tool: (toolName: string) => tools.find(item => item.name === toolName)!, reference: 'artifact:' + store.draft('chart')!.id };
}

/** 详查读的是成果里的完整快照（full），定位校验必须用同一张盘。 */
function chartValue(store: MemoryStore, name: string, callId = 'chart') {
  const artifact = store.draft(callId)!;
  const result = artifact.result as { chartSnapshot?: { result: unknown }; details: unknown };
  return getAgentChart({ type: 'tool', id: callId, name, title: name, status: 'completed', output: result.chartSnapshot?.result ?? result.details })!;
}

function checkTargets(details: DrilldownDetails, chart: NonNullable<ReturnType<typeof getAgentChart>>) {
  const known = new Set(getChartTargets(chart).map(target => target.id));
  assert.ok(details.targets.length > 0 && details.targets.length <= 16, '定位数量在 1–16 之间');
  assert.ok(details.targets.every(target => known.has(target.id)), '定位都真实存在于盘面');
}

const QIMEN = { year: 2024, month: 1, day: 1, hour: 3, juNumber: 1, dunType: 'yang' };
const LIUYAO = { question: '财运怎么样？', yongShenTargets: ['妻财'], method: 'select', hexagramName: '天火同人', date: '2026-02-10 14:00:00' };
const DALIUREN = { date: '2026-04-10', hour: 14, minute: 30, timezone: 'Asia/Shanghai', birthYear: 1990, gender: 'male' };
const ASTROLOGY = { birthYear: 1990, birthMonth: 1, birthDay: 1, birthHour: 12, birthMinute: 30, latitude: 40.7128, longitude: -74.006, transitDateTime: '2026-04-10T09:30:00' };

test('紫微、奇门、六壬、占星与六爻的详查都重算自己的盘并给出真实盘位', async () => {
  const ziwei = await chartSetup('ziwei', birth);
  const ziweiResult = await ziwei.tool('ziwei_palace').execute('z1', { reference: ziwei.reference, palace: '命宫' });
  const ziweiDetails = ziweiResult.details as DrilldownDetails;
  assert.equal(ziweiDetails.chartKind, 'ziwei');
  assert.equal((ziweiDetails.result.查询 as { 宫位: string }).宫位, '命宫');
  assert.match(ziweiResult.content[0].text, /# 紫微宫位详查/);
  assert.ok(ziweiDetails.targets.length && ziweiDetails.targets.every(target => target.id.startsWith('ziwei:')));
  checkTargets(ziweiDetails, chartValue(ziwei.store, 'ziwei'));

  const qimen = await chartSetup('qimen', QIMEN);
  const qimenResult = await qimen.tool('qimen_palace').execute('q1', { reference: qimen.reference, palace: 1 });
  const qimenDetails = qimenResult.details as DrilldownDetails;
  assert.equal(qimenDetails.chartKind, 'qimen');
  assert.ok(qimenDetails.targets.some(target => target.id === 'qimen:palace:1'), '所查宫位在定位里');
  checkTargets(qimenDetails, chartValue(qimen.store, 'qimen'));

  const daliuren = await chartSetup('daliuren', DALIUREN);
  const daliurenResult = await daliuren.tool('daliuren_lessons').execute('d1', { reference: daliuren.reference });
  const daliurenDetails = daliurenResult.details as DrilldownDetails;
  assert.equal(daliurenDetails.chartKind, 'daliuren');
  assert.ok(daliurenDetails.targets.some(target => target.id.startsWith('daliuren:lesson:')));
  assert.ok(daliurenDetails.targets.some(target => target.id.startsWith('daliuren:transmission:')));
  checkTargets(daliurenDetails, chartValue(daliuren.store, 'daliuren'));

  const astrology = await chartSetup('astrology', ASTROLOGY);
  const venus = astrology.tool('astrology_point').execute('a1', { reference: astrology.reference, planet: 'venus' });
  const venusDetails = (await venus).details as DrilldownDetails;
  assert.equal(venusDetails.chartKind, 'astrology');
  assert.ok(venusDetails.targets.some(target => target.id.startsWith('astrology:natal:')), '金星的本命位置');
  checkTargets(venusDetails, chartValue(astrology.store, 'astrology'));
  const house = await astrology.tool('astrology_point').execute('a2', { reference: astrology.reference, house: 7 });
  const houseDetails = house.details as DrilldownDetails;
  assert.ok(houseDetails.targets.some(target => target.id === 'astrology:house:6'), '第 7 宫还原为宫位目标');
  checkTargets(houseDetails, chartValue(astrology.store, 'astrology'));

  const liuyao = await chartSetup('liuyao', LIUYAO);
  const liuyaoResult = await liuyao.tool('liuyao_line').execute('l1', { reference: liuyao.reference, role: '世' });
  const liuyaoDetails = liuyaoResult.details as DrilldownDetails;
  assert.equal(liuyaoDetails.chartKind, 'liuyao');
  assert.deepEqual(liuyaoDetails.targets.map(target => target.id), ['liuyao:line:3'], '世爻在九三');
  checkTargets(liuyaoDetails, chartValue(liuyao.store, 'liuyao'));
});

test('bazi_wuxing 与 bazi_liunian_scan 复用八字成果，紫微与六爻的已存记录可以重建', async t => {
  mockChartOwnership(t);
  const { tool, reference, store } = await setup();
  const wuxing = await tool('bazi_wuxing').execute('w1', { reference });
  const liunian = await tool('bazi_liunian_scan').execute('n1', { reference, fromYear: 2026, toYear: 2027 });
  const liunianDetails = liunian.details as DrilldownDetails;
  assert.equal((liunianDetails.result.逐年 as unknown[]).length, 2);
  assert.equal((wuxing.details as DrilldownDetails).chartKind, 'bazi');
  checkTargets(wuxing.details as DrilldownDetails, chartValue(store, 'bazi', 'calculate'));
  checkTargets(liunianDetails, chartValue(store, 'bazi', 'calculate'));

  const store2 = new MemoryStore(), run2 = row(), ziweiId = randomUUID(), liuyaoId = randomUUID();
  const ziweiRow = { id: ziweiId, gender: 'male', birth_date: '1990-01-15', birth_time: '09:00', timezone: 'Asia/Shanghai', calendar_type: 'solar' };
  const liuyaoRow = { id: liuyaoId, question: '财运怎么样？', hexagram_code: '101111', changed_hexagram_code: null, changed_lines: [], yongshen_targets: ['妻财'], created_at: '2026-02-10T09:30:00.000Z' };
  t.mock.method(require('../lib/data-sources'), 'getProvider', async () => ({ get: async (id: string) => id === ziweiId ? ziweiRow : liuyaoRow, formatForAI: async () => '' }));
  const tools2 = await createAgentTools(store2, run2, run2.checkpoint);
  const ziweiResult = await tools2.find(item => item.name === 'ziwei_palace')!.execute('zs', { reference: 'ziwei_chart:' + ziweiId, palace: '命宫' });
  const ziweiDetails = ziweiResult.details as DrilldownDetails;
  assert.equal(ziweiDetails.chartReference, 'ziwei_chart:' + ziweiId);
  assert.equal((ziweiDetails.result.查询 as { 宫位: string }).宫位, '命宫');
  const liuyaoResult = await tools2.find(item => item.name === 'liuyao_line')!.execute('ls', { reference: 'liuyao_divination:' + liuyaoId, line: 3 });
  const liuyaoDetails = liuyaoResult.details as DrilldownDetails;
  assert.equal((liuyaoDetails.result.爻详情 as unknown[]).length, 1);
});

test('无占问的六爻记录可以查看，但逐爻详查会说明缺少什么', async t => {
  mockChartOwnership(t);
  const store = new MemoryStore(), run = row(), liuyaoId = randomUUID();
  const liuyaoRow = {
    id: liuyaoId, question: '', hexagram_code: '101111', changed_hexagram_code: null,
    changed_lines: [], yongshen_targets: null, created_at: '2026-02-10T09:30:00.000Z',
  };
  t.mock.method(require('../lib/data-sources'), 'getProvider', async () => ({
    get: async (id: string) => id === liuyaoId ? liuyaoRow : null,
    formatForAI: async () => '',
  }));
  const tools = await createAgentTools(store, run, run.checkpoint);
  const inspected = await tools.find(item => item.name === 'inspect_chart')!.execute('i1', { reference: 'liuyao_divination:' + liuyaoId });
  const details = inspected.details as { chartKind?: string; chartReference?: string };
  assert.equal(details.chartKind, 'liuyao');
  assert.equal(details.chartReference, 'liuyao_divination:' + liuyaoId);
  await assert.rejects(
    () => tools.find(item => item.name === 'liuyao_line')!.execute('l1', { reference: 'liuyao_divination:' + liuyaoId, line: 3 }),
    /没有占问事项/u,
  );
});

test('详查副标题读出新增的查询参数', () => {
  assert.equal(describeDrilldownSelection({ reference: 'x', palace: '命宫', scope: 'yearly', targetDate: '2026-03-13' }), '命宫 · 流年 · 2026-03-13');
  assert.equal(describeDrilldownSelection({ reference: 'x', palace: 1 }), '第 1 宫');
  assert.equal(describeDrilldownSelection({ reference: 'x', locate: { type: '日干' } }), '按日干定位');
  assert.equal(describeDrilldownSelection({ reference: 'x', planet: 'venus' }), '金星');
  assert.equal(describeDrilldownSelection({ reference: 'x', house: 7 }), '第 7 宫');
  assert.equal(describeDrilldownSelection({ reference: 'x', line: 3 }), '第 3 爻');
  assert.equal(describeDrilldownSelection({ reference: 'x', fromYear: 2026, toYear: 2029 }), '2026 年起 · 至 2029 年');
  assert.equal(describeDrilldownSelection({ reference: 'x', leiShen: '贵人', focus: '传' }), '类神 贵人 · 只看 传');
  assert.equal(describeDrilldownSelection({ reference: 'x', year: 2027, pillars: ['日柱', '流年'], types: ['六冲'] }), '2027 年 · 涉及 日柱、流年 · 只看 六冲');
  assert.equal(describeDrilldownSelection({ reference: 'x', sections: ['通根', '透干'], detailLevel: 'full' }), '只看 通根、透干 · 完整');
  // Defaults read as nothing: the full scope and the lean text are what a bare query gets anyway.
  assert.equal(describeDrilldownSelection({ reference: 'x', planet: 'saturn', focus: '全部', detailLevel: 'default' }), '土星');
  assert.equal(describeDrilldownSelection({ reference: 'x', planet: 'saturn', focus: '流运' }), '土星 · 只看 流运');
});
