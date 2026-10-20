import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, buildToolSuccessPayload } from 'taibu-core/mcp';
import type { BaziCanonicalJSON, BaziRelationsCanonicalJSON, BaziWuxingCanonicalJSON } from 'taibu-core/bazi';
import {
    BAZI_COLUMNS, baziBoardRows, layoutRelations, relationLegSlots, relationMode, relationTone, visibleRelationEdges, type RelationRow,
} from '../lib/divination/ganzhi-relation-layout';

const cell = (柱: string, 部位: '天干' | '地支', 字: string) => ({ 柱, 部位, 字 });
const birth = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
const structured = async <T>(name: string, input: Record<string, unknown>) =>
    buildToolSuccessPayload(name, await executeTool(name, input)).structuredContent as T;

test('relation tones name every Core relation type and split relations from flow', () => {
    assert.deepEqual(relationTone('天干五合'), { tone: 'combine', mark: '合' });
    assert.deepEqual(relationTone('合', 3), { tone: 'combine', mark: '三合' });
    assert.deepEqual(relationTone('冲克'), { tone: 'clash', mark: '冲' });
    assert.deepEqual(relationTone('相刑'), { tone: 'punish', mark: '刑' });
    assert.deepEqual(relationTone('相破'), { tone: 'break', mark: '破' });
    assert.deepEqual(relationTone('三会'), { tone: 'meet', mark: '会' });
    assert.deepEqual(relationTone('干支生'), { tone: 'generate', mark: '生' });
    assert.deepEqual(relationTone('天干克'), { tone: 'control', mark: '克' });
    assert.deepEqual(relationTone('干支同气'), { tone: 'same', mark: '同' });
    assert.deepEqual(relationTone('通根'), { tone: 'root', mark: '根' });
    assert.equal(relationMode(relationTone('六冲').tone), 'relations');
    assert.equal(relationMode(relationTone('透干').tone), 'flow');
    // Unknown types are still drawn rather than dropped.
    assert.deepEqual(relationTone('暗拱'), { tone: 'combine', mark: '暗拱' });
});

test('stem and branch arcs take bands, and overlapping spans move out a lane', () => {
    const rows: RelationRow[] = [
        { id: 'a', 类型: '六冲', 说明: '子午冲', 位置: [cell('年柱', '地支', '子'), cell('时柱', '地支', '午')] },
        { id: 'b', 类型: '六合', 说明: '丑子合', 位置: [cell('月柱', '地支', '丑'), cell('日柱', '地支', '子')] },
        { id: 'c', 类型: '天干五合', 说明: '甲己合', 位置: [cell('年柱', '天干', '甲'), cell('月柱', '天干', '己')] },
        { id: 'd', 类型: '合', 说明: '申子辰三合', 位置: [cell('年柱', '地支', '申'), cell('月柱', '地支', '子'), cell('时柱', '地支', '辰')] },
        { id: 'e', 类型: '流年冲', 说明: '不在盘上的柱', 位置: [cell('流年', '地支', '午'), cell('日柱', '地支', '子')] },
    ];
    const layout = layoutRelations(rows, BAZI_COLUMNS);
    const byId = new Map(layout.edges.map(edge => [edge.id, edge]));
    assert.equal(byId.has('e'), false, 'a pillar not on the board is not drawn');
    assert.equal(byId.get('c')!.band, 'stem');
    assert.equal(byId.get('b')!.band, 'branch');
    assert.deepEqual(byId.get('b')!.span, [1, 2]);
    assert.equal(byId.get('b')!.lane, 0, 'the shortest span sits nearest the glyphs');
    assert.equal(byId.get('d')!.mark, '三合');
    assert.notEqual(byId.get('a')!.lane, byId.get('d')!.lane, 'overlapping spans never share a lane');
    assert.deepEqual(layout.lanes, { stem: 1, branch: 3, cross: 0 });
});

test('cross-band facts stay in one pillar as short arrows and become markers at the result glyph across pillars', () => {
    const rows: RelationRow[] = [
        { 类型: '干支生', 结果: '支生干', 说明: '日柱辰土生庚金', 位置: [cell('日柱', '天干', '庚'), cell('日柱', '地支', '辰')] },
        { 类型: '通根', 结果: '余气', 说明: '日干庚通根年支巳', 位置: [cell('日柱', '天干', '庚'), cell('年柱', '地支', '巳')] },
        { 类型: '透干', 结果: '本气', 说明: '年支巳藏丙透出', 位置: [cell('年柱', '地支', '巳'), cell('月柱', '天干', '丙')] },
        { 类型: '透干', 结果: '中气', 说明: '年支巳藏戊透出', 位置: [cell('年柱', '地支', '巳'), cell('年柱', '天干', '甲')] },
    ];
    const layout = layoutRelations(rows, BAZI_COLUMNS);
    const [self, root, reveal, samePillar] = layout.edges;
    assert.equal(self.shape, 'vertical');
    assert.deepEqual(self.cells.map(item => item.part), ['地支', '天干'], '支生干 points from the branch up to the stem');
    // 跨柱的通根 / 透干只标在结果字旁：通根标地支、透干标天干，不再画穿行长线。
    assert.equal(root.shape, 'marker');
    assert.deepEqual([root.band, root.anchor?.column, root.anchor?.part, root.result], ['cross', '年柱', '地支', '余气']);
    assert.equal(reveal.shape, 'marker');
    assert.deepEqual([reveal.band, reveal.anchor?.column, reveal.anchor?.part], ['cross', '月柱', '天干']);
    assert.equal(samePillar.shape, 'vertical', 'a hidden stem surfacing in its own pillar stays a short vertical arrow');
    assert.equal(layout.lanes.cross, 1, 'markers do not take lanes, so the stem–branch gap stays one row tall');
});

test('adjacent stem 生克 point from the stem the description names first', () => {
    const rows: RelationRow[] = [
        { 类型: '天干克', 说明: '月干癸水克年干丁火', 位置: [cell('年柱', '天干', '丁'), cell('月柱', '天干', '癸')] },
        { 类型: '天干克', 说明: '日干戊土克月干癸水', 位置: [cell('月柱', '天干', '癸'), cell('日柱', '天干', '戊')] },
        { 类型: '天干生', 说明: '时干己土生年干丁火', 位置: [cell('年柱', '天干', '丁'), cell('时柱', '天干', '己')] },
    ];
    const [first, second, third] = layoutRelations(rows, BAZI_COLUMNS).edges;
    assert.deepEqual(first.cells.map(item => item.char), ['癸', '丁']);
    assert.deepEqual(second.cells.map(item => item.char), ['戊', '癸']);
    assert.deepEqual(third.cells.map(item => item.char), ['己', '丁']);
});

test('visible edges follow the mode and filters, and a located edge of the other mode becomes an aside badge', () => {
    const rows: RelationRow[] = [
        { id: 'clash', 类型: '六冲', 说明: '冲', 位置: [cell('年柱', '地支', '子'), cell('月柱', '地支', '午')] },
        { id: 'harm', 类型: '相害', 说明: '害', 位置: [cell('月柱', '地支', '午'), cell('日柱', '地支', '丑')] },
        { id: 'gen', 类型: '生', 说明: '生', 位置: [cell('年柱', '天干', '甲'), cell('月柱', '天干', '丙')] },
    ];
    const layout = layoutRelations(rows, BAZI_COLUMNS);
    const visible = (mode: Parameters<typeof visibleRelationEdges>[1], hidden: string[] = [], located: string[] = []) =>
        visibleRelationEdges(layout, mode, new Set(hidden), new Set(located));
    const ids = (...args: Parameters<typeof visible>) => visible(...args).edges.map(edge => edge.id).sort();
    assert.deepEqual(ids('relations'), ['clash', 'harm']);
    assert.deepEqual(ids('flow'), ['gen']);
    assert.deepEqual(ids('relations', ['冲']), ['harm']);
    // 定位过的线在所属模式里始终保留。
    assert.deepEqual(ids('relations', ['冲'], ['clash']), ['clash', 'harm']);
    // 定位的是另一种模式的关系：不画线，收成字旁标记，并给该带留出标记的一层。
    const aside = visible('flow', [], ['clash']);
    assert.deepEqual(aside.edges.map(edge => edge.id), ['gen']);
    assert.deepEqual(aside.aside!.map(edge => edge.id), ['clash']);
    assert.equal(aside.lanes.branch, 1);
    // 「全部」同时画两种线，没有旁置标记。
    assert.deepEqual(ids('all'), ['clash', 'gen', 'harm']);
    assert.deepEqual(visible('all', [], ['clash']).aside, []);
    // 选择「不显示」时盘面清空。
    assert.deepEqual(ids('off', [], ['gen']), []);
    assert.deepEqual(visibleRelationEdges(layout, 'relations', new Set(['冲']), new Set()).lanes.branch, 1, 'lanes are recomputed after hiding');
});

test('adjacent flow pairs connect directly between the glyphs, one line per gap; everything else stays a bracket', () => {
    const rows: RelationRow[] = [
        { id: 'gen', 类型: '天干生', 说明: '年干甲木生月干丙火', 位置: [cell('年柱', '天干', '甲'), cell('月柱', '天干', '丙')] },
        { id: 'same', 类型: '天干同气', 说明: '年干甲木与月干丙火（示例）', 位置: [cell('年柱', '天干', '甲'), cell('月柱', '天干', '丙')] },
        { id: 'far', 类型: '天干克', 说明: '日干庚金克年干甲木', 位置: [cell('年柱', '天干', '甲'), cell('日柱', '天干', '庚')] },
        { id: 'tie', 类型: '天干五合', 说明: '丙辛合', 位置: [cell('月柱', '天干', '丙'), cell('日柱', '天干', '辛')] },
    ];
    const layout = layoutRelations(rows, BAZI_COLUMNS);
    const shape = (id: string) => layout.edges.find(edge => edge.id === id)!.shape;
    assert.equal(shape('gen'), 'inline', 'two side-by-side stems are linked directly');
    assert.equal(shape('same'), 'arc', 'a second line in the same gap falls back to a bracket instead of overlapping');
    assert.equal(shape('far'), 'arc', 'a pair that skips a pillar is a bracket');
    assert.equal(shape('tie'), 'arc', '合冲刑害 keep their brackets');
    // 直连线不占层：只有三条括线分层（同气与丙辛合相接共用内层，隔柱的克在外层）。
    assert.equal(layout.lanes.stem, 2);
});

test('showing everything keeps flow brackets inside and relation brackets outside, and line legs never cross', () => {
    const rows: RelationRow[] = [
        { id: 'far', 类型: '天干生', 说明: '年干甲木生日干庚金（示例）', 位置: [cell('年柱', '天干', '甲'), cell('日柱', '天干', '庚')] },
        { id: 'hit', 类型: '天干相冲', 说明: '丙壬冲', 位置: [cell('月柱', '天干', '丙'), cell('时柱', '天干', '壬')] },
        { id: 'tie', 类型: '天干五合', 说明: '甲己合', 位置: [cell('年柱', '天干', '甲'), cell('月柱', '天干', '己')] },
    ];
    const all = visibleRelationEdges(layoutRelations(rows, BAZI_COLUMNS), 'all', new Set(), new Set());
    const lane = (id: string) => all.edges.find(edge => edge.id === id)!.lane;
    assert.equal(lane('far'), 0, 'flow brackets take the inner lanes');
    assert.ok(lane('hit') > lane('far') && lane('tie') > lane('far'), 'relation brackets sit outside every flow bracket');
    // 关系单独显示时从最内层排起。
    const relationsOnly = visibleRelationEdges(layoutRelations(rows, BAZI_COLUMNS), 'relations', new Set(), new Set());
    assert.equal(relationsOnly.edges.find(edge => edge.id === 'tie')!.lane, 0);

    // 线脚次序：往右去的外层在左、内层在右；往左去的内层在左；往左的都在往右的左边。
    const nested: RelationRow[] = [
        { id: 'A', 类型: '六合', 说明: '子丑合', 位置: [cell('年柱', '地支', '子'), cell('月柱', '地支', '丑')] },
        { id: 'B', 类型: '六冲', 说明: '子午冲', 位置: [cell('年柱', '地支', '子'), cell('日柱', '地支', '午')] },
        { id: 'C', 类型: '相害', 说明: '丑午害', 位置: [cell('月柱', '地支', '丑'), cell('时柱', '地支', '午')] },
    ];
    const layout = layoutRelations(nested, BAZI_COLUMNS);
    const laneOf = (id: string) => layout.edges.find(edge => edge.id === id)!.lane;
    assert.deepEqual([laneOf('A'), laneOf('B'), laneOf('C')], [0, 1, 0], 'arcs meeting at one glyph share a lane; a crossing one moves out');
    const slots = relationLegSlots(layout.edges, item => BAZI_COLUMNS.indexOf(item.column as typeof BAZI_COLUMNS[number]));
    const at = (key: string) => slots.get(key)!;
    assert.ok(at('B@0') < at('A@0'), 'at 子 the outer 冲 leg stands left of the inner 合 leg, so it never cuts the 合 line');
    assert.ok(at('A@1') < at('C@0'), 'at 丑 the line arriving from the left stands left of the line leaving to the right');
});

test('the board draws Core relations, adds drilldown-only ones, and switches flow to the wuxing facts', async () => {
    const chart = await structured<BaziCanonicalJSON>('bazi', birth);
    const relations = await structured<BaziRelationsCanonicalJSON>('bazi_relations', birth);
    const wuxing = await structured<BaziWuxingCanonicalJSON>('bazi_wuxing', birth);
    const detail = chart.干支关系明细!;
    const none = new Set<string>();
    // Without drilldowns only adjacent stem 生克 are drawn for flow.
    const plain = layoutRelations(baziBoardRows(detail, {}, none), BAZI_COLUMNS);
    assert.ok(plain.edges.length > 0);
    assert.ok(plain.edges.every(edge => edge.mode === 'relations' || edge.span[1] - edge.span[0] === 1));
    // A located non-adjacent 生克 is kept so the model's focus is visible.
    const far = detail.find(row => row.类型 === '生' && Math.abs(BAZI_COLUMNS.indexOf(row.位置[0].柱 as '年柱') - BAZI_COLUMNS.indexOf(row.位置[1].柱 as '年柱')) > 1)!;
    assert.ok(baziBoardRows(detail, {}, new Set([far.id])).some(row => row.id === far.id));
    // The relations drilldown supplies 丑辰相破, which the chart summary does not list.
    const withRelations = baziBoardRows(detail, { relations: relations.原局关系 }, none);
    assert.ok(withRelations.some(row => row.类型 === '相破' && row.id?.startsWith('relations:')));
    assert.equal(baziBoardRows(detail, { relations: [...relations.原局关系, ...relations.原局关系] }, none).filter(row => row.类型 === '相破').length, 1);
    // With the wuxing drilldown, flow uses its facts and never repeats a pair.
    const full = layoutRelations(baziBoardRows(detail, { relations: relations.原局关系, wuxing }, none), BAZI_COLUMNS);
    const flow = full.edges.filter(edge => edge.mode === 'flow');
    assert.ok(flow.every(edge => edge.id.startsWith('wuxing:')));
    assert.equal(flow.filter(edge => edge.shape === 'vertical').length, 4, 'each pillar has one 干支自坐');
    assert.equal(flow.filter(edge => edge.tone === 'root').length, wuxing.通根.length);
    const pairs = flow.filter(edge => edge.shape === 'arc').map(edge => edge.mark + edge.cells.map(item => item.column).sort().join());
    assert.equal(new Set(pairs).size, pairs.length);
});

test('the board follows what the agent last looked at: a relations or wuxing drilldown, or a located relation', async () => {
    const { getBaziViewing, getLatestBaziFacts } = await import('../components/chat/agent/bazi-board');
    const reference = 'bazi_chart:11111111-1111-4111-8111-111111111111';
    const relations = [{ id: 'bazi-relation-0', 类型: '六冲', 位置: [] }, { id: 'bazi-relation-1', 类型: '生', 位置: [] }];
    const tool = (id: string, name: string, output: unknown = {}, status: 'completed' | 'running' = 'completed') => ({ type: 'tool' as const, id, name, title: name, status, input: { reference }, output });
    const focus = (id: string, targetIds: string[], to = reference) => tool(id, 'focus_chart', { chartFocus: { version: 1, reference: to, targetIds, includeRelated: false, caption: '' } });
    assert.equal(getBaziViewing([], reference, relations), null);
    assert.deepEqual(getBaziViewing([tool('a', 'bazi_relations')], reference, relations), { key: 'a', mode: 'relations', label: '干支关系' });
    // A running wuxing drilldown already switches the board.
    assert.equal(getBaziViewing([tool('a', 'bazi_relations'), tool('b', 'bazi_wuxing', {}, 'running')], reference, relations)?.mode, 'flow');
    assert.equal(getBaziViewing([tool('a', 'bazi_wuxing'), focus('f', ['bazi-relation-0'])], reference, relations)?.mode, 'relations');
    assert.equal(getBaziViewing([tool('a', 'bazi_relations'), focus('f', ['bazi-relation-1'])], reference, relations)?.mode, 'flow');
    // The latest focus on a cell says nothing about lines; a focus on another chart is ignored.
    assert.equal(getBaziViewing([tool('a', 'bazi_wuxing'), focus('f', ['bazi:cell:2:1'])], reference, relations), null);
    assert.equal(getBaziViewing([tool('a', 'bazi_wuxing'), focus('f', ['bazi-relation-0'], 'bazi_chart:22222222-2222-4222-8222-222222222222')], reference, relations)?.mode, 'flow');
    // A step the reader opened decides what was being looked at then.
    assert.equal(getBaziViewing([tool('a', 'bazi_relations'), tool('b', 'bazi_wuxing')], reference, relations, tool('a', 'bazi_relations'))?.mode, 'relations');
    // Only completed, well-formed results feed the board.
    const wuxing = await structured<BaziWuxingCanonicalJSON>('bazi_wuxing', birth);
    assert.equal(getLatestBaziFacts([tool('w', 'bazi_wuxing', { result: wuxing }, 'running')]).wuxing, null);
    assert.equal(getLatestBaziFacts([tool('w', 'bazi_wuxing', { result: { 五行统计: [] } })]).wuxing, null);
    assert.equal(getLatestBaziFacts([tool('w', 'bazi_wuxing', { result: wuxing })]).wuxing, wuxing);
});
