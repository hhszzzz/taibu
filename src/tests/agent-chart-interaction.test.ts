import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Message } from '@earendil-works/pi-ai';
import { baziPillarEntries, toBaziJson, type BaziPillarJSON, type BaziOutput } from 'taibu-core/bazi';
import { buildToolSuccessPayload, executeTool, listToolDefinitions } from 'taibu-core/mcp';
import { getAgentChart, getAgentToolText, type AgentToolPart } from '../lib/agent/tool-presentation';
import { AGENT_CHART_NAMES } from '../lib/agent/tool-catalog';
import { CHART_SOURCE_KINDS, chartQuestion, getAgentChartReference, getChartFocus, getChartResources, getChartTargets, getLatestChartFocus, parseChartReference, type ChartFocus } from '../lib/agent/chart-interaction';
import { createAgentTools } from '../lib/agent/tools.server';
import { authorizeChartReference, loadAgentChart } from '../lib/agent/chart-tools.server';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { AgentStore, type AgentRunRow } from '../lib/agent/store.server';
import { config, row, MemoryStore, scripted } from './helpers/agent-runtime-fixture';
import { createMockScopedDb } from './helpers/db-mock';

const birth = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
const chartTool = async (name: 'bazi' | 'ziwei'): Promise<AgentToolPart> => {
  const result = buildToolSuccessPayload(name, await executeTool(name, birth));
  return { type: 'tool', name, id: name, title: name, status: 'completed', output: { artifactId: randomUUID(), result: result.structuredContent } };
};

beforeEach(t => {
  assert.ok('mock' in t);
  t.mock.method(require('../lib/app-settings'), 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' }));
});

class ChartStore extends MemoryStore {
  override async chartArtifact(_run: AgentRunRow, id: string) {
    return [...this.drafts.values()].find(artifact => artifact.kind === 'calculation' && artifact.id === id) ?? null;
  }
}

test('all eleven systems expose actual unique targets in default/full output and serialized native history', async () => {
  for (const definition of listToolDefinitions().filter(tool => Object.hasOwn(AGENT_CHART_NAMES, tool.name))) {
    const input = { ...definition.inputSchema.examples![0] as Record<string, unknown> };
    if (definition.name === 'astrology') Object.assign(input, { latitude: 31.2304, longitude: 121.4737, timezone: 'Asia/Shanghai' });
    if (definition.name === 'tarot') Object.assign(input, { seed: 'chart-target-directory', referenceYear: 2026 });
    const result = await executeTool(definition.name, input);
    for (const detailLevel of ['default', 'full'] as const) {
      const payload = buildToolSuccessPayload(definition.name, result, { detailLevel });
      const tool: AgentToolPart = { type: 'tool', id: definition.name, title: definition.name, name: definition.name, status: 'completed', output: { artifactId: randomUUID(), result: payload.structuredContent } };
      const value = getAgentChart(tool)!;
      assert.ok(value, definition.name + ' ' + detailLevel);
      const before = JSON.stringify(value), targets = getChartTargets(value);
      assert.ok(targets.length > 0, definition.name);
      assert.equal(new Set(targets.map(target => target.id)).size, targets.length);
      assert.ok(targets.every(target => target.label.trim().length > 0), definition.name + ' labels every position');
      assert.deepEqual(getChartTargets(getAgentChart(JSON.parse(JSON.stringify(tool)))!), targets);
      assert.equal(JSON.stringify(value), before);
    }
  }
});

test('all saved chart provider references are explicit, normalized and reject unrelated data types', () => {
  const id = randomUUID();
  for (const source of Object.keys(CHART_SOURCE_KINDS)) assert.deepEqual(parseChartReference((source + ':' + id).toUpperCase()), { source, id });
  for (const source of ['face_reading', 'mbti_reading', 'daily_fortune', '__proto__']) assert.equal(parseChartReference(source + ':' + id), null);
});

test('normalized friendship palace remains selectable and usable in chart follow-up questions', async () => {
  const tool = await chartTool('ziwei'), chart = getAgentChart(tool)!, reference = getAgentChartReference(tool)!;
  const target = getChartTargets(chart).find(target => target.label.includes('交友'));
  assert.ok(target);
  // The question names the positions and the chart; the model drills into them by itself, nothing asks it to mark them.
  assert.equal(chartQuestion(reference, [target]), '请继续分析这张命盘的' + target.label + '。命盘引用：' + reference + '。');
});

test('chart resources keep the latest step per reading without changing the transcript', async () => {
  const calculation = await chartTool('bazi');
  const inspected: AgentToolPart = { ...calculation, id: 'inspect', name: 'inspect_chart', output: { chartKind: 'bazi', chartReference: getAgentChartReference(calculation), result: getAgentChart(calculation)!.chart } };
  const repeated = { ...inspected, id: 'inspect-again' };
  const saved = { ...inspected, id: 'saved-inspect', output: { ...inspected.output as object, chartReference: 'bazi_chart:' + randomUUID() } };
  const savedAgain = { ...saved, id: 'saved-inspect-again' };
  const fallback = { ...inspected, id: 'incomplete', output: {}, canonicalText: '未保存完整盘面' };
  const receipt: AgentToolPart = { type: 'tool', id: 'focus', name: 'focus_chart', title: '定位', status: 'completed', output: {} };
  const tools = [calculation, inspected, repeated, saved, savedAgain, fallback, receipt];
  const before = JSON.stringify(tools);
  assert.equal(getChartResources(tools).find(resource => resource.reference === getAgentChartReference(calculation))!.tool.id, repeated.id);
  assert.equal(JSON.stringify(tools), before, 'all native inspection steps remain in the transcript');
});

test('native calculations retain full immutable snapshots for every system, with no second calculation or draw on inspect/cache replay', async () => {
  const store = new ChartStore(), run = row();
  const tools = await createAgentTools(store, run, run.checkpoint);
  for (const definition of listToolDefinitions().filter(tool => Object.hasOwn(AGENT_CHART_NAMES, tool.name))) {
    const args = { ...definition.inputSchema.examples![0] as Record<string, unknown> };
    if (definition.name === 'astrology') Object.assign(args, { latitude: 31.2304, longitude: 121.4737, timezone: 'Asia/Shanghai' });
    if (definition.name === 'tarot') Object.assign(args, { seed: 'immutable-tarot', referenceYear: 2026 });
    const tool = tools.find(tool => tool.name === definition.name)!;
    await tool.execute(definition.name, args);
    const original = store.draft(definition.name)!;
    assert.equal(original.result.chartSnapshot?.kind, definition.name);
    const before = JSON.stringify(original.result.chartSnapshot);
    const value = await loadAgentChart(store, run, 'artifact:' + original.id);
    assert.equal(value.value.kind, definition.name);
    assert.ok(getChartTargets(value.value).length > 0);
    if (value.value.kind === 'almanac') assert.equal(value.value.chart.时辰吉凶?.length, 13, 'the original daily hours include both early and late Zi periods');
    if (value.value.kind === 'astrology') assert.equal(value.value.chart.扩展信息?.宫位宫头?.length, 12);
    await tool.execute(definition.name, args);
    assert.equal(JSON.stringify(store.draft(definition.name)!.result.chartSnapshot), before);
  }
  assert.equal(store.writes.filter(write => write.name === 'agent_cache_tool').length, 11);
  const astro = tools.find(tool => tool.name === 'astrology')!;
  await astro.execute('approximate', { birthYear: 1990, birthMonth: 1, birthDay: 1, birthHour: 12 });
  const approximate = await loadAgentChart(store, run, 'artifact:' + store.draft('approximate')!.id);
  assert.equal(approximate.value.kind, 'astrology');
  if (approximate.value.kind === 'astrology') assert.equal(approximate.value.chart.基础坐标.计算模式, '近似盘');
  await tools.find(tool => tool.name === 'taiyi')!.execute('traditional', { system: 'traditional', mode: 'hour', date: '2026-04-10', hour: 9, timezone: 'Asia/Shanghai' });
  const traditional = await loadAgentChart(store, run, 'artifact:' + store.draft('traditional')!.id);
  assert.equal(getChartTargets(traditional.value).filter(target => /^taiyi:palace:\d+$/.test(target.id)).length, 17);
});

test('every saved chart lookup filters both record ID and current owner', async t => {
  const run = row(), calls: Array<{ table: string; filters: Record<string, string> }> = [];
  let owned = true;
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        const filters: Record<string, string> = {};
        const query = {
          select() { return query; },
          where(key: string, _operator: string, value: string) { filters[key] = value; return query; },
          async executeTakeFirst() { calls.push({ table, filters }); return owned ? { id: filters.id } : undefined; },
        };
        return query;
      },
    } as never),
  });
  t.mock.method(require('../lib/db/context.server'), 'systemDb', () => scoped);
  const store = new AgentStore({} as never);
  for (const [source, kind] of Object.entries(CHART_SOURCE_KINDS)) {
    const id = randomUUID();
    assert.equal(await authorizeChartReference(store, run, source + ':' + id), kind);
    assert.deepEqual(calls.at(-1)!.filters, { id, user_id: run.user_id });
  }
  owned = false;
  await assert.rejects(authorizeChartReference(store, run, 'tarot_reading:' + randomUUID()), /不存在或无权访问/);
});

test('saved charts reuse existing result adapters; Tarot preserves its original draw and a questionless Liuyao still opens', async t => {
  const id = randomUUID(), store = new ChartStore(), run = row();
  const definitions = listToolDefinitions();
  const savedRows: Record<string, Record<string, unknown>> = {};
  for (const [source, kind] of [['daliuren_divination', 'daliuren'], ['meihua_divination', 'meihua'], ['xiaoliuren_divination', 'xiaoliuren']] as const) {
    const result = await executeTool(kind, definitions.find(tool => tool.name === kind)!.inputSchema.examples![0] as Record<string, unknown>);
    savedRows[source] = { result_data: kind === 'daliuren' ? result : { result } };
  }
  savedRows.qimen_chart = { year: 2026, month: 3, day: 25, hour: 10, minute: 0, timezone: 'Asia/Shanghai', pan_type: 'zhuan', ju_method: 'chaibu', zhi_fu_ji_gong: 'ji_liuyi', dun_type: 'yin', ju_number: 3 };
  savedRows.liuyao_divination = { hexagram_code: '101010', changed_hexagram_code: '101110', changed_lines: [3], yongshen_targets: ['官鬼'], question: '工作会顺利吗', created_at: '2026-03-25T00:00:00Z' };
  const tarot = require('../lib/divination/tarot') as typeof import('../lib/divination/tarot');
  savedRows.tarot_reading = { spread_id: 'three-card', question: '我该怎么做', cards: ['愚者', '恋人', '力量'].map((name, index) => ({ card: tarot.findTarotCardByChineseName(name)!, orientation: index === 2 ? 'reversed' : 'upright', position: ['过去', '现在', '未来'][index] })) };
  t.mock.method(require('../lib/data-sources'), 'getProvider', async (source: string) => ({ async get(recordId: string, userId: string) { assert.equal(recordId, id); assert.equal(userId, run.user_id); return savedRows[source]; }, formatForAI() { return '原始记录规范文本'; } }));
  t.mock.method(require('../lib/divination/tarot'), 'drawCards', () => { assert.fail('viewing a saved spread must never draw cards'); });
  for (const source of Object.keys(savedRows)) {
    const result = await loadAgentChart(store, run, source + ':' + id);
    assert.equal(result.value.kind, CHART_SOURCE_KINDS[source as keyof typeof CHART_SOURCE_KINDS]);
    assert.ok(getChartTargets(result.value).length > 0);
    if (result.value.kind === 'qimen') assert.equal(result.value.chart.基本信息.局式, '阴遁3局');
    if (result.value.kind === 'tarot') assert.deepEqual(result.value.chart.牌阵展开.map(card => [card.塔罗牌, card.状态]), [['愚者', '正位'], ['恋人', '正位'], ['力量', '逆位']]);
  }
  savedRows.liuyao_divination.question = null;
  savedRows.liuyao_divination.yongshen_targets = null;
  const questionless = await loadAgentChart(store, run, 'liuyao_divination:' + id);
  assert.equal(questionless.value.kind, 'liuyao');
  if (questionless.value.kind === 'liuyao') {
    assert.equal(questionless.value.chart.六爻.length, 6);
    assert.ok(questionless.value.chart.六爻.every(line => line.旺衰 && line.动静), 'a questionless board keeps strength and movement');
  }
  assert.match(questionless.canonicalText, /未填写所问之事/u);
  assert.match(questionless.canonicalText, /旺衰/u);
  savedRows.liuyao_divination.yongshen_targets = ['官鬼'];
  const targetOnly = await loadAgentChart(store, run, 'liuyao_divination:' + id);
  assert.match(targetOnly.canonicalText, /已记录的用神目标：官鬼/u);
  assert.match(targetOnly.canonicalText, /## 用神分析/u);
  assert.equal(store.drafts.size, 0, 'inspection does not save new calculations');
});

test('Core exposes actual bazi relation endpoints in default/full formats without changing the canonical text', async () => {
  const result = await executeTool('bazi', birth);
  const lean = buildToolSuccessPayload('bazi', result);
  const full = buildToolSuccessPayload('bazi', result, { detailLevel: 'full' });
  const value = getAgentChart({ type: 'tool', name: 'bazi', id: 'core', title: 'bazi', status: 'completed', output: lean.structuredContent })!;
  assert.equal(value.kind, 'bazi');
  if (value.kind !== 'bazi') return;
  const targets = getChartTargets(value);
  assert.equal(targets.filter(target => target.kind === 'bazi_cell').length, 8);
  assert.ok(value.chart.干支关系明细!.length > 0);
  assert.deepEqual(value.chart.干支关系明细, (full.structuredContent as typeof value.chart).干支关系明细);
  for (const relation of value.chart.干支关系明细!) {
    for (const cell of relation.位置) {
      const pillar: BaziPillarJSON = value.chart.四柱.find((item: BaziPillarJSON) => item.柱 === cell.柱)!;
      assert.equal(cell.字, pillar.干支.charAt(cell.部位 === '天干' ? 0 : 1));
    }
    assert.ok(targets.some(target => target.id === relation.id));
  }
  const original = JSON.stringify(value);
  const legacy = structuredClone(value);
  if (legacy.kind === 'bazi') delete legacy.chart.干支关系明细;
  assert.equal(getChartTargets(legacy).filter(target => target.kind === 'bazi_relation').length, 0, 'legacy natural-language relations cannot invent coordinates');
  assert.equal(JSON.stringify(value), original);
  // 出生时辰未知的盘只有三柱：只能定位到六个字，关系也都落在这六个字上
  const withoutHour = { gender: birth.gender, birthYear: birth.birthYear, birthMonth: birth.birthMonth, birthDay: birth.birthDay };
  const unknown = getAgentChart({ type: 'tool', name: 'bazi', id: 'bazi', title: 'bazi', status: 'completed',
    output: { artifactId: randomUUID(), result: buildToolSuccessPayload('bazi', await executeTool('bazi', withoutHour)).structuredContent } })!;
  const unknownTargets = getChartTargets(unknown);
  assert.equal(unknownTargets.filter(target => target.kind === 'bazi_cell').length, 6);
  assert.ok(unknownTargets.every(target => target.kind !== 'bazi_cell' || target.cell.柱 !== '时柱'));
});

test('Ziwei targets use returned palaces, exact star group/index and work with slim palace indices', async () => {
  const value = getAgentChart(await chartTool('ziwei'))!;
  assert.equal(value.kind, 'ziwei');
  const targets = getChartTargets(value);
  assert.equal(targets.filter(target => target.kind === 'ziwei_palace').length, 12);
  assert.ok(targets.some(target => target.kind === 'ziwei_star'));
  assert.equal(new Set(targets.map(target => target.id)).size, targets.length);
});

test('repeated characters retain their actual pillar positions and nonadjacent stem endpoints', async () => {
  const output = await executeTool('bazi', birth) as BaziOutput;
  baziPillarEntries(output).forEach(({ pillar }, index) => { pillar.stem = index < 2 ? '甲' : '庚'; pillar.branch = index < 2 ? '午' : '子'; });
  output.relations = [{ type: '刑', pillars: ['年支', '月支'], description: '午午自刑' }];
  output.tianGanWuHe = []; output.diZhiBanHe = []; output.diZhiSanHui = [];
  output.tianGanChongKe = [{ stemA: '甲', stemB: '庚', positions: ['年干', '时干'] }];
  const json = toBaziJson(output);
  assert.deepEqual(json.干支关系明细!.find(relation => relation.类型 === '刑')!.位置, [
    { 柱: '年柱', 部位: '地支', 字: '午' }, { 柱: '月柱', 部位: '地支', 字: '午' },
  ]);
  assert.deepEqual(json.干支关系明细!.find(relation => relation.类型 === '冲克')!.位置, [
    { 柱: '年柱', 部位: '天干', 字: '甲' }, { 柱: '时柱', 部位: '天干', 字: '庚' },
  ]);
});

test('an older conversation\'s focus steps and chart references restore from serialized history; failed ones do not apply', async () => {
  const tool = await chartTool('bazi'), value = getAgentChart(tool)!, reference = getAgentChartReference(tool)!;
  const focus: ChartFocus = { version: 1, reference, targetIds: ['bazi:cell:2:1'], includeRelated: true, caption: '查看日支' };
  const action: AgentToolPart = { type: 'tool', id: 'focus', name: 'focus_chart', title: '定位', status: 'completed', output: { chartFocus: focus } };
  const inspector: AgentToolPart = { ...tool, id: 'inspect', name: 'inspect_chart', output: { chartReference: reference, chartKind: value.kind, result: value.chart } };
  const restored = JSON.parse(JSON.stringify([tool, inspector, action])) as AgentToolPart[];
  assert.deepEqual(getLatestChartFocus(restored), focus);
  assert.equal(getChartResources(restored).length, 1, 'inspecting again is not a new reading');
  assert.equal(getChartResources(restored)[0].tool.id, 'inspect');
  assert.equal(getChartFocus({ ...action, status: 'failed' }), null);
  assert.equal(getChartFocus({ ...action, output: { chartFocus: { ...focus, reference: 'untrusted' } } }), null);
  assert.ok(chartQuestion(reference, getChartTargets(value).filter(target => target.id === focus.targetIds[0])).includes(reference));
  assert.equal(parseChartReference('artifact:../../secrets'), null);
});

test('reinspection invalidates only the old focus for that reading, including after saved data edits and history restore', async () => {
  const tool = await chartTool('bazi'), value = getAgentChart(tool)!, reference = 'bazi_chart:' + randomUUID();
  const otherReference = 'ziwei_chart:' + randomUUID();
  const focus: ChartFocus = { version: 1, reference, targetIds: ['bazi:cell:2:1'], includeRelated: true, caption: '旧盘日支' };
  const action: AgentToolPart = { type: 'tool', id: 'focus-old', name: 'focus_chart', title: '定位', status: 'completed', output: { chartFocus: focus } };
  const unrelated = { ...action, id: 'focus-other', output: { chartFocus: { ...focus, reference: otherReference, caption: '另一张盘' } } };
  const inspector: AgentToolPart = { ...tool, id: 'inspect-old', name: 'inspect_chart', output: { chartReference: reference, chartKind: value.kind, result: value.chart } };
  const revised = buildToolSuccessPayload('bazi', await executeTool('bazi', { ...birth, birthYear: 2001, birthMonth: 10, birthDay: 1 }));
  const reinspected = { ...inspector, id: 'inspect-new', output: { ...inspector.output as object, result: revised.structuredContent } };
  const before = [inspector, action, unrelated];
  assert.deepEqual(getLatestChartFocus([...before, { ...reinspected, status: 'failed' }], reference), focus, 'failed inspection does not replace the original snapshot');
  const restored = JSON.parse(JSON.stringify([...before, reinspected])) as AgentToolPart[];
  assert.equal(getLatestChartFocus(restored, reference), null, 'old coordinates cannot be applied to an updated reading');
  assert.equal(getLatestChartFocus(restored)?.reference, otherReference, 'other readings keep their own focus');
  assert.deepEqual(getChartResources(restored)[0].value.chart, revised.structuredContent);
  const fresh = { ...action, id: 'focus-new', output: { chartFocus: { ...focus, caption: '新盘日支' } } };
  assert.equal(getLatestChartFocus([...restored, fresh], reference)?.caption, '新盘日支');
  assert.equal(getLatestChartFocus([inspector, action, { ...reinspected, output: inspector.output }], reference), null, 'a successful reinspection clears old model analysis even when the result is unchanged');
});

test('inspect_chart reads a chart of this conversation and nothing else; no tool asks the model to mark positions', async t => {
  const store = new ChartStore(), run = row();
  const tools = await createAgentTools(store, run, run.checkpoint);
  assert.ok(!tools.some(tool => tool.name === 'focus_chart'), 'the board follows the drilldowns');
  await tools.find(tool => tool.name === 'bazi')!.execute('calculate', birth);
  const reference = 'artifact:' + store.draft('calculate')!.id;
  const inspect = tools.find(tool => tool.name === 'inspect_chart')!;
  await assert.rejects(inspect.execute('wrong-owner', { reference: 'artifact:' + randomUUID() }), /不在当前会话/);
  const result = await inspect.execute('inspect', { reference });
  assert.equal((result.details as { chartKind: string }).chartKind, 'bazi');
  t.mock.method(require('../lib/app-settings'), 'readFeatureModuleStateFresh', async () => ({ status: 'disabled' }));
  await assert.rejects(inspect.execute('inspect-off', { reference }), /该功能已关闭/);
});

test('artifact database lookup scopes both owner and conversation rather than trusting an artifact UUID', async () => {
  const predicates: Array<[string, unknown]> = [];
  let joined = '';
  const query = {
    innerJoin: (table: string, left: string, right: string) => { joined = `${table}:${left}:${right}`; return query; },
    selectAll: () => query,
    where: (key: string, _operator: string, value: unknown) => { predicates.push([key, value]); return query; },
    executeTakeFirst: async () => undefined,
  };
  const db = createMockScopedDb({ tx: async work => work({ selectFrom: (table: string) => {
    assert.equal(table, 'agent_run_artifacts as artifact');
    return query;
  } } as never) });
  const store = new AgentStore(db);
  const run = row(), id = randomUUID();
  assert.equal(await store.chartArtifact(run, id), null);
  assert.equal(joined, 'agent_runs as run:run.id:artifact.run_id');
  assert.deepEqual(predicates, [['artifact.id', id], ['artifact.kind', 'calculation'], ['run.user_id', run.user_id], ['run.conversation_id', run.conversation_id]]);
});

test('a saved chart is read again by each new inspection, never by a replay, and rejects revoked ownership', async t => {
  const store = new ChartStore(), run = row(), id = randomUUID();
  let owned = true, reads = 0;
  const record = { id, gender: 'male', birth_date: '1990-01-15', birth_time: '09:00', timezone: 'Asia/Shanghai' };
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      selectFrom() {
        const query = {
          select() { return query; },
          where() { return query; },
          async executeTakeFirst() { return owned ? { id } : undefined; },
        };
        return query;
      },
    } as never),
  });
  t.mock.method(require('../lib/db/context.server'), 'systemDb', () => scoped);
  t.mock.method(require('../lib/data-sources'), 'getProvider', async () => ({ get: async (_id: string, userId: string) => { assert.equal(userId, run.user_id); reads++; return record; } }));
  const tools = await createAgentTools(store, run, run.checkpoint), reference = 'bazi_chart:' + id;
  const inspect = tools.find(tool => tool.name === 'inspect_chart')!;
  const inspected = await inspect.execute('inspect-saved', { reference });
  record.birth_date = '2001-10-01';
  assert.deepEqual(await inspect.execute('inspect-saved', { reference }), inspected, 'a replay returns the reading it took');
  assert.equal(reads, 1, 'a replay never reads the record again');
  const edited = await inspect.execute('inspect-edited', { reference });
  assert.notDeepEqual((edited.details as { result: unknown }).result, (inspected.details as { result: unknown }).result);
  owned = false;
  await assert.rejects(inspect.execute('inspect-saved', { reference }), /不存在或无权访问/);
});

test('a saved bazi record without a birth time inspects as three pillars instead of failing', async t => {
  const store = new ChartStore(), run = row(), id = randomUUID();
  const record = { id, gender: 'female', birth_date: '1995-01-09', birth_time: null, timezone: 'Asia/Shanghai' };
  const query = { select: () => query, where: () => query, executeTakeFirst: async () => ({ id }) };
  t.mock.method(require('../lib/db/context.server'), 'systemDb', () => createMockScopedDb({ tx: async (work) => work({ selectFrom: () => query } as never) }));
  t.mock.method(require('../lib/data-sources'), 'getProvider', async () => ({ get: async () => record }));
  const tools = await createAgentTools(store, run, run.checkpoint);
  const inspected = await tools.find(tool => tool.name === 'inspect_chart')!.execute('inspect-unknown', { reference: 'bazi_chart:' + id });
  const chart = (inspected.details as { result: { 四柱: BaziPillarJSON[]; 基本信息: { 出生时辰?: string } } }).result;
  assert.deepEqual(chart.四柱.map(pillar => pillar.干支), ['甲戌', '丁丑', '庚子']);
  assert.match(chart.基本信息.出生时辰 ?? '', /^未知（未排时柱/u);
});

test('native Pi tools project a drilldown onto its chart and rebuild the exact highlight after an outer checkpoint is lost', async () => {
  const store = new ChartStore(), run = row();
  const streamFn = scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'calculate', name: 'bazi', arguments: birth }];
    const reference = 'artifact:' + store.draft('calculate')!.id;
    if (index === 1) return [{ type: 'toolCall', id: 'search', name: 'tool_search', arguments: { query: '刑冲合害' } }];
    if (index === 2) return [{ type: 'toolCall', id: 'relations', name: 'bazi_relations', arguments: { reference, year: 2027 } }];
    return [{ type: 'text', text: '流年关系分析完成' }];
  });
  await executeAgentRun(store, run, undefined, { config, streamFn });
  const first = store.writes.filter(write => write.name === 'agent_finish_run').at(-1)!;
  assert.equal(first.args.p_status, 'completed');
  const message = first.args.p_message as AgentRunRow['public_message'];
  const tools = message.agent!.parts.filter((part): part is AgentToolPart => part.type === 'tool');
  const focus = getLatestChartFocus(tools);
  assert.equal(focus?.caption, '八字岁运刑冲合害');
  assert.deepEqual(focus!.targetIds, (store.draft('relations')!.result.details as { targets: Array<{ id: string }> }).targets.map(target => target.id));
  assert.ok(focus!.targetIds.length > 0, 'the drilldown lights the cells it touched without being asked');
  assert.equal(getChartResources(tools).length, 1);
  const bazi = tools.find(part => part.name === 'bazi')!;
  assert.ok(typeof bazi.durationMs === 'number' && bazi.durationMs >= 0, 'durable 1.1.0 records tool execution time on the native result');
  const snapshot = structuredClone(first.args.p_checkpoint) as AgentRunRow['checkpoint'];
  snapshot.parts = [];
  run.checkpoint = snapshot;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => { assert.fail('completed tools must not execute again'); }) });
  const restored = store.writes.filter(write => write.name === 'agent_finish_run').at(-1)!.args.p_message as AgentRunRow['public_message'];
  assert.deepEqual(getLatestChartFocus(restored.agent!.parts.filter((part): part is AgentToolPart => part.type === 'tool')), focus);
  assert.equal(store.writes.filter(write => write.name === 'agent_cache_tool').length, 2);
  assert.ok(store.writes.every(write => write.name !== 'agent_create_run'));
});

test('reading a saved chart hands the model its reference in a model-only line; other records get none', async t => {
  const store = new ChartStore(), run = row(), id = randomUUID();
  const contexts: unknown[] = [];
  t.mock.method(require('../lib/data-sources'), 'getProvider', async () => ({
    get: async (_id: string, _user: string, ctx: unknown) => { contexts.push(ctx); return { id }; },
    formatForAI: async () => '已保存的规范文本',
  }));
  const linked: string[] = [];
  t.mock.method(require('../lib/agent/archive.server'), 'readLinkedRecords', async (_db: unknown, userId: string, type: string) => {
    linked.push(`${userId}:${type}`);
    return type === 'bazi_chart' ? '【关联的命理记录】\n- 2020-01-01｜人生事件｜换工作（Agent 记录）' : null;
  });
  const read = (await createAgentTools(store, run, run.checkpoint)).find(tool => tool.name === 'read_user_data')!;
  const chart = await read.execute('read-chart', { type: 'bazi_chart', id });
  // Pi sends only the content to the model, so the reference inspect_chart needs must be in the text. The linked
  // records follow the chart in the same text, so the workspace's canonical copy shows them too.
  assert.deepEqual(chart.content.map(part => part.text), [
    '已保存的规范文本\n\n【关联的命理记录】\n- 2020-01-01｜人生事件｜换工作（Agent 记录）',
    `命盘引用: bazi_chart:${id}。查看或详查这张盘时作为 reference 传入。`,
  ]);
  assert.deepEqual(parseChartReference((chart.details as { chartReference: string }).chartReference), { source: 'bazi_chart', id });
  // The case notes come with the chart, up to the reading's limit.
  assert.equal((contexts[0] as { caseEventLimit?: number }).caseEventLimit, 50);
  const other = await read.execute('read-other', { type: 'mbti_reading', id });
  assert.deepEqual(other.content.map(part => part.text), ['已保存的规范文本']);
  assert.equal((other.details as { chartReference?: string }).chartReference, undefined);
  // A record is not something records link to.
  await read.execute('read-record', { type: 'ming_record', id });
  assert.deepEqual(linked, [`${run.user_id}:bazi_chart`, `${run.user_id}:mbti_reading`]);
});

const resultText = (messages: readonly Message[], callId: string) => messages.flatMap(message => message.role === 'toolResult' && message.toolCallId === callId
  ? message.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join('\n');

test('a cast hands the model Core text and its reference, and inspecting returns the full text alone', async () => {
  const store = new ChartStore(), run = row();
  let cast = '';
  const streamFn = scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'calculate', name: 'ziwei', arguments: birth }];
    if (index === 1) return [{ type: 'toolCall', id: 'inspect', name: 'inspect_chart', arguments: { reference: 'artifact:' + store.draft('calculate')!.id } }];
    return [{ type: 'text', text: '命宫看完了' }];
  }, messages => { cast ||= resultText(messages, 'calculate'); });
  await executeAgentRun(store, run, undefined, { config, streamFn });
  assert.match(cast, new RegExp(`命盘引用: artifact:${store.draft('calculate')!.id}。查看或详查这张盘时作为 reference 传入。$`, 'u'));
  assert.doesNotMatch(cast, /ziwei:(palace|star):|位置清单|focus_chart/u, 'no positions or IDs to copy');
  const message = store.writes.filter(write => write.name === 'agent_finish_run').at(-1)!.args.p_message as AgentRunRow['public_message'];
  const tools = message.agent!.parts.filter((part): part is AgentToolPart => part.type === 'tool');
  const [chartText, ...rest] = store.draft('inspect')!.result.content.map(part => part.text);
  assert.deepEqual(rest, []);
  assert.equal(chartText, store.draft('calculate')!.result.chartSnapshot!.canonicalText, 'the full-detail text kept when the chart was cast');
  assert.equal(tools.find(tool => tool.name === 'inspect_chart')!.canonicalText, chartText);
  // The cast step shows the chart text only; the reference is written for the model.
  assert.doesNotMatch(getAgentToolText(tools.find(tool => tool.name === 'ziwei')!) ?? '', /命盘引用/u);
});
