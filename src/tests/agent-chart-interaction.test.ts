import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { toBaziJson, type BaziPillarJSON, type BaziOutput } from 'taibu-core/bazi';
import { buildToolSuccessPayload, executeTool, listToolDefinitions } from 'taibu-core/mcp';
import { getAgentChart, type AgentToolPart } from '../lib/agent/tool-presentation';
import { AGENT_CHART_NAMES } from '../lib/agent/tool-catalog';
import { CHART_SOURCE_KINDS, chartQuestion, deduplicateChartResults, getAgentChartReference, getChartFocus, getChartResources, getChartTargets, getLatestChartFocus, parseChartReference, validateChartFocus } from '../lib/agent/chart-interaction';
import { createAgentTools } from '../lib/agent/tools.server';
import { authorizeChartReference, loadAgentChart, loadInspectedChart } from '../lib/agent/chart-tools.server';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { AgentStore, type AgentRunRow } from '../lib/agent/store.server';
import { config, row, MemoryStore, scripted } from './helpers/agent-runtime-fixture';

const birth = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
const chartTool = async (name: 'bazi' | 'ziwei'): Promise<AgentToolPart> => {
  const result = buildToolSuccessPayload(name, await executeTool(name, birth));
  return { type: 'tool', name, id: name, title: name, status: 'completed', output: { artifactId: randomUUID(), result: result.structuredContent } };
};

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
    return [...this.drafts.values()].reverse().find(artifact => artifact.tool_name === 'inspect_chart' && (artifact.result.details as { chartReference?: string }).chartReference === reference) ?? null;
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
      const before = JSON.stringify(value), targets = getChartTargets(value), reference = getAgentChartReference(tool)!;
      assert.ok(targets.length > 0, definition.name);
      assert.equal(new Set(targets.map(target => target.id)).size, targets.length);
      assert.deepEqual(getChartTargets(getAgentChart(JSON.parse(JSON.stringify(tool)))!), targets);
      for (const target of targets) assert.deepEqual(validateChartFocus(value, reference, [target.id], true, target.label.slice(0, 160)).targetIds, [target.id]);
      assert.throws(() => validateChartFocus(value, reference, [definition.name + ':unknown:999'], true, '未知位置'), /不在这张命盘/);
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
  assert.deepEqual(validateChartFocus(chart, reference, [target.id], true, '核对交友宫').targetIds, [target.id]);
  assert.ok(chartQuestion(reference, [target]).includes('交友'));
});

test('inline results keep one chart per reading and preserve saved inspections, fallback text and unrelated receipts', async () => {
  const calculation = await chartTool('bazi');
  const inspected: AgentToolPart = { ...calculation, id: 'inspect', name: 'inspect_chart', output: { chartKind: 'bazi', chartReference: getAgentChartReference(calculation), result: getAgentChart(calculation)!.chart } };
  const repeated = { ...inspected, id: 'inspect-again' };
  const saved = { ...inspected, id: 'saved-inspect', output: { ...inspected.output as object, chartReference: 'bazi_chart:' + randomUUID() } };
  const savedAgain = { ...saved, id: 'saved-inspect-again' };
  const fallback = { ...inspected, id: 'incomplete', output: {}, canonicalText: '未保存完整盘面' };
  const receipt: AgentToolPart = { type: 'tool', id: 'focus', name: 'focus_chart', title: '定位', status: 'completed', output: {} };
  const tools = [calculation, inspected, repeated, saved, savedAgain, fallback, receipt];
  const before = JSON.stringify(tools);
  assert.deepEqual(deduplicateChartResults(tools).map(tool => tool.id), [calculation.id, savedAgain.id, fallback.id, receipt.id]);
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

test('every saved chart lookup filters both record ID and current owner', async () => {
  const run = row(), calls: Array<{ table: string; filters: Record<string, string> }> = [];
  let owned = true;
  const store = new AgentStore({ from(table: string) {
    const filters: Record<string, string> = {};
    const query = { select() { return query; }, eq(key: string, value: string) { filters[key] = value; return query; }, async maybeSingle() { calls.push({ table, filters }); return { data: owned ? { id: filters.id } : null, error: null }; } };
    return query;
  } } as never);
  for (const [source, kind] of Object.entries(CHART_SOURCE_KINDS)) {
    const id = randomUUID();
    assert.equal(await authorizeChartReference(store, run, source + ':' + id), kind);
    assert.deepEqual(calls.at(-1)!.filters, { id, user_id: run.user_id });
  }
  owned = false;
  await assert.rejects(authorizeChartReference(store, run, 'tarot_reading:' + randomUUID()), /不存在或无权访问/);
});

test('saved charts reuse existing result adapters; Tarot preserves its original draw and old incomplete Liuyao stays explicit', async t => {
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
  await assert.rejects(loadAgentChart(store, run, 'liuyao_divination:' + id), /已存结果不完整/);
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
  const unknown = structuredClone(value);
  if (unknown.kind === 'bazi') unknown.chart.四柱[3].干支 = '**';
  assert.equal(getChartTargets(unknown).filter(target => target.kind === 'bazi_cell').length, 6);
  assert.equal(JSON.stringify(value), original);
});

test('Ziwei targets use returned palaces, exact star group/index and work with slim palace indices', async () => {
  const value = getAgentChart(await chartTool('ziwei'))!;
  assert.equal(value.kind, 'ziwei');
  const targets = getChartTargets(value);
  assert.equal(targets.filter(target => target.kind === 'ziwei_palace').length, 12);
  assert.ok(targets.some(target => target.kind === 'ziwei_star'));
  assert.equal(new Set(targets.map(target => target.id)).size, targets.length);
  const ref = 'artifact:' + randomUUID();
  assert.throws(() => validateChartFocus(value, ref, ['ziwei:palace:12'], true, '宫位'), /不在这张命盘/);
  assert.deepEqual(validateChartFocus(value, ref, [targets[0].id, targets[0].id], false, '当前宫位').targetIds, [targets[0].id]);
});

test('repeated characters retain their actual pillar positions and nonadjacent stem endpoints', async () => {
  const output = await executeTool('bazi', birth) as BaziOutput;
  const keys = ['year', 'month', 'day', 'hour'] as const;
  keys.forEach((key, index) => { output.fourPillars[key].stem = index < 2 ? '甲' : '庚'; output.fourPillars[key].branch = index < 2 ? '午' : '子'; });
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

test('completed native actions and chart references restore from serialized history; failed actions do not apply', async () => {
  const tool = await chartTool('bazi'), value = getAgentChart(tool)!, reference = getAgentChartReference(tool)!;
  const focus = validateChartFocus(value, reference, ['bazi:cell:2:1'], true, '查看日支');
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
  const focus = validateChartFocus(value, reference, ['bazi:cell:2:1'], true, '旧盘日支');
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

test('focus requires a real inspected snapshot, validates targets and rechecks disabled features even on cache replay', async t => {
  const store = new ChartStore(), run = row();
  const tools = await createAgentTools(store, run, run.checkpoint);
  await tools.find(tool => tool.name === 'bazi')!.execute('calculate', birth);
  const reference = 'artifact:' + store.draft('calculate')!.id;
  const inspect = tools.find(tool => tool.name === 'inspect_chart')!, focus = tools.find(tool => tool.name === 'focus_chart')!;
  const args = { reference, targetIds: ['bazi:cell:2:1'], caption: '日支' };
  await assert.rejects(focus.execute('without-inspect', args), /先使用 inspect_chart/);
  await assert.rejects(inspect.execute('wrong-owner', { reference: 'artifact:' + randomUUID() }), /不在当前会话/);
  await inspect.execute('inspect', { reference });
  await assert.rejects(focus.execute('invalid', { ...args, targetIds: ['fake-palace'] }), /不在这张命盘/);
  const result = await focus.execute('focus', args);
  assert.equal((result.details as { chartFocus: { caption: string } }).chartFocus.caption, '日支');
  t.mock.method(require('../lib/app-settings'), 'readFeatureModuleStateFresh', async () => ({ status: 'disabled' }));
  await assert.rejects(focus.execute('focus', args), /该功能已关闭/);
});

test('artifact database lookup scopes both owner and conversation rather than trusting an artifact UUID', async () => {
  const predicates: Array<[string, unknown]> = [];
  const query = {
    select: () => query, eq: (key: string, value: unknown) => { predicates.push([key, value]); return query; },
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const store = new AgentStore({ from: () => query } as unknown as ConstructorParameters<typeof AgentStore>[0]);
  const run = row(), id = randomUUID();
  assert.equal(await store.chartArtifact(run, id), null);
  assert.deepEqual(predicates, [['id', id], ['kind', 'calculation'], ['agent_runs.user_id', run.user_id], ['agent_runs.conversation_id', run.conversation_id]]);
});

test('inspection lookup uses native numeric task order and never guesses between ambiguous legacy snapshots', async () => {
  const run = row(), reference = 'artifact:' + randomUUID(), predicates: Array<[string, unknown]> = [], orders: unknown[] = [];
  const newer = { id: randomUUID(), result: { inspectionOrder: 40 } }, older = { id: randomUUID(), result: { inspectionOrder: 9 } };
  let rows: Array<{ id: string; result: { inspectionOrder?: number } }> = [newer, older];
  const query = {
    select: () => query, eq: (key: string, value: unknown) => { predicates.push([key, value]); return query; },
    order: (key: string, options: unknown) => { orders.push([key, options]); return query; },
    limit: (value: number) => { assert.equal(value, 2); return query; },
    then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
  };
  const store = new AgentStore({ from: (table: string) => { assert.equal(table, 'agent_run_artifacts'); return query; } } as never);
  assert.equal((await store.inspectedChart(run, reference))!.id, newer.id);
  assert.deepEqual(predicates, [['run_id', run.id], ['tool_name', 'inspect_chart'], ['result->details->>chartReference', reference]]);
  assert.deepEqual(orders, [['result->inspectionOrder', { ascending: false, nullsFirst: false }]], 'JSON numeric order, not text ordering or an invented SQL column');
  rows = [{ id: older.id, result: {} }, { id: newer.id, result: {} }];
  await assert.rejects(store.inspectedChart(run, reference), /重新调用 inspect_chart/);
  rows = rows.slice(0, 1);
  assert.equal((await store.inspectedChart(run, reference))!.id, older.id);
  const memory = new ChartStore(), tools = await createAgentTools(memory, run, run.checkpoint);
  await tools.find(tool => tool.name === 'bazi')!.execute('calculate', birth);
  const args = { reference: 'artifact:' + memory.draft('calculate')!.id };
  const inspect = tools.find(tool => tool.name === 'inspect_chart')!;
  await inspect.execute('9:inspect-earlier', args);
  await inspect.execute('40:inspect-latest', args);
  assert.equal(memory.draft('9:inspect-earlier')!.result.inspectionOrder, 9);
  assert.equal(memory.draft('40:inspect-latest')!.result.inspectionOrder, 40);
  await inspect.execute('40:inspect-latest', args);
  assert.equal(memory.writes.filter(write => write.name === 'agent_cache_tool').length, 3, 'replaying the latest inspection preserves its original order and row');
});

test('saved-chart focus uses the inspected snapshot and rejects revoked ownership on replay', async t => {
  const store = new ChartStore(), run = row(), id = randomUUID();
  let owned = true, reads = 0;
  const record = { id, gender: 'male', birth_date: '1990-01-15', birth_time: '09:00', timezone: 'Asia/Shanghai' };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: owned ? { id } : null, error: null }) };
  Object.assign(store.db, { from: () => query });
  t.mock.method(require('../lib/data-sources'), 'getProvider', async () => ({ get: async (_id: string, userId: string) => { assert.equal(userId, run.user_id); reads++; return record; } }));
  const tools = await createAgentTools(store, run, run.checkpoint), reference = 'bazi_chart:' + id;
  const inspected = await tools.find(tool => tool.name === 'inspect_chart')!.execute('inspect-saved', { reference });
  record.birth_date = '2001-10-01';
  const snapshot = await loadInspectedChart(store, run, reference);
  assert.deepEqual(snapshot.value.chart, (inspected.details as { result: unknown }).result);
  const focus = tools.find(tool => tool.name === 'focus_chart')!, args = { reference, targetIds: ['bazi:cell:2:1'], caption: '日支' };
  await focus.execute('focus-saved', args);
  assert.equal(reads, 1, 'focusing never recalculates the inspected reading');
  owned = false;
  await assert.rejects(focus.execute('focus-saved', args), /不存在或无权访问/);
});

test('native Pi tools project chart actions and rebuild the exact focus after an outer checkpoint is lost', async () => {
  const store = new ChartStore(), run = row();
  const streamFn = scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'calculate', name: 'bazi', arguments: birth }];
    const reference = 'artifact:' + store.draft('calculate')!.id;
    if (index === 1) return [{ type: 'toolCall', id: 'inspect', name: 'inspect_chart', arguments: { reference } }];
    if (index === 2) return [{ type: 'toolCall', id: 'focus', name: 'focus_chart', arguments: { reference, targetIds: ['bazi:cell:2:1'], caption: '模型正在查看日支' } }];
    if (index === 3) return [{ type: 'toolCall', id: 'select', name: 'select_final_artifacts', arguments: { artifactIds: [store.draft('calculate')!.id] } }];
    return [{ type: 'text', text: '日支分析完成' }];
  });
  await executeAgentRun(store, run, undefined, { config, streamFn });
  const first = store.writes.filter(write => write.name === 'agent_finish_run').at(-1)!;
  assert.equal(first.args.p_status, 'completed');
  const message = first.args.p_message as AgentRunRow['public_message'];
  const tools = message.agent!.parts.filter((part): part is AgentToolPart => part.type === 'tool');
  const focus = getLatestChartFocus(tools);
  assert.equal(focus?.caption, '模型正在查看日支');
  assert.equal(getChartResources(tools).length, 1);
  const bazi = tools.find(part => part.name === 'bazi')!;
  assert.ok(typeof bazi.durationMs === 'number' && bazi.durationMs >= 0, 'durable 1.1.0 records tool execution time on the native result');
  const snapshot = structuredClone(first.args.p_checkpoint) as AgentRunRow['checkpoint'];
  snapshot.parts = [];
  run.checkpoint = snapshot;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => { assert.fail('completed tools must not execute again'); }) });
  const restored = store.writes.filter(write => write.name === 'agent_finish_run').at(-1)!.args.p_message as AgentRunRow['public_message'];
  assert.deepEqual(getLatestChartFocus(restored.agent!.parts.filter((part): part is AgentToolPart => part.type === 'tool')), focus);
  assert.equal(store.writes.filter(write => write.name === 'agent_cache_tool').length, 4);
  assert.ok(store.writes.every(write => write.name !== 'agent_create_run'));
});
