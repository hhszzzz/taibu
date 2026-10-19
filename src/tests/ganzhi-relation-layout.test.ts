import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, buildToolSuccessPayload } from 'taibu-core/mcp';
import type { BaziCanonicalJSON, BaziRelationsCanonicalJSON, BaziWuxingCanonicalJSON } from 'taibu-core/bazi';
import {
    BAZI_COLUMNS, baziBoardRows, layoutRelations, relationMode, relationTone, visibleRelationEdges, type RelationRow,
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
    assert.deepEqual(layout.lanes, { stem: 1, branch: 3 });
});

test('cross-band facts become vertical lines in one pillar or markers beside a glyph', () => {
    const rows: RelationRow[] = [
        { 类型: '干支生', 结果: '支生干', 说明: '日柱辰土生庚金', 位置: [cell('日柱', '天干', '庚'), cell('日柱', '地支', '辰')] },
        { 类型: '通根', 结果: '余气', 说明: '日干庚通根年支巳', 位置: [cell('日柱', '天干', '庚'), cell('年柱', '地支', '巳')] },
        { 类型: '透干', 结果: '本气', 说明: '年支巳藏丙透出', 位置: [cell('年柱', '地支', '巳'), cell('月柱', '天干', '丙')] },
    ];
    const [self, root, reveal] = layoutRelations(rows, BAZI_COLUMNS).edges;
    assert.equal(self.shape, 'vertical');
    assert.deepEqual(self.cells.map(item => item.part), ['地支', '天干'], '支生干 points from the branch up to the stem');
    assert.equal(root.shape, 'marker');
    assert.deepEqual([root.band, root.anchor?.column, root.result], ['branch', '年柱', '余气']);
    assert.deepEqual([reveal.band, reveal.anchor?.column], ['stem', '月柱']);
});

test('visible edges follow the mode and filters, but a located edge always stays', () => {
    const rows: RelationRow[] = [
        { id: 'clash', 类型: '六冲', 说明: '冲', 位置: [cell('年柱', '地支', '子'), cell('月柱', '地支', '午')] },
        { id: 'harm', 类型: '相害', 说明: '害', 位置: [cell('月柱', '地支', '午'), cell('日柱', '地支', '丑')] },
        { id: 'gen', 类型: '生', 说明: '生', 位置: [cell('年柱', '天干', '甲'), cell('月柱', '天干', '丙')] },
    ];
    const layout = layoutRelations(rows, BAZI_COLUMNS);
    const ids = (mode: Parameters<typeof visibleRelationEdges>[1], hidden: string[] = [], located: string[] = []) =>
        visibleRelationEdges(layout, mode, new Set(hidden), new Set(located)).edges.map(edge => edge.id).sort();
    assert.deepEqual(ids('relations'), ['clash', 'harm']);
    assert.deepEqual(ids('flow'), ['gen']);
    assert.deepEqual(ids('relations', ['冲']), ['harm']);
    assert.deepEqual(ids('off', [], ['gen']), ['gen']);
    assert.deepEqual(visibleRelationEdges(layout, 'relations', new Set(['冲']), new Set()).lanes.branch, 1, 'lanes are recomputed after hiding');
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
