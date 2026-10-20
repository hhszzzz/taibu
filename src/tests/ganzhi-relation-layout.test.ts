import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, buildToolSuccessPayload } from 'taibu-core/mcp';
import type { BaziCanonicalJSON, BaziRelationsCanonicalJSON, BaziWuxingCanonicalJSON } from 'taibu-core/bazi';
import {
    BAZI_COLUMNS, baziBoardRows, layoutRelations, placeBadges, relationLegSlots, relationMode, relationSpotlight, relationTone, type RelationRow,
} from '../lib/divination/ganzhi-relation-layout';

const cell = (柱: string, 部位: '天干' | '地支', 字: string) => ({ 柱, 部位, 字 });
// 己巳 丁丑 庚辰 辛巳
const birth = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
// 甲子 壬申 丙戌 癸巳：年干甲四支无木
const sparse = { gender: 'male', birthYear: 1984, birthMonth: 8, birthDay: 20, birthHour: 10 };
const structured = async <T>(name: string, input: Record<string, unknown>) =>
    buildToolSuccessPayload(name, await executeTool(name, input)).structuredContent as T;
const tool = (id: string, name: string, result: unknown, status: 'completed' | 'running' = 'completed') =>
    ({ type: 'tool' as const, id, name, title: name, status, input: {}, output: { result } });
const sorted = (set: ReadonlySet<string> | undefined) => [...(set ?? [])].sort();

test('relation tones name every Core relation type and split relations from flow', () => {
    assert.deepEqual(relationTone('天干五合'), { tone: 'combine', mark: '合' });
    assert.deepEqual(relationTone('合', 3), { tone: 'combine', mark: '三合' });
    assert.deepEqual(relationTone('冲克'), { tone: 'clash', mark: '冲' });
    assert.deepEqual(relationTone('相刑'), { tone: 'punish', mark: '刑' });
    assert.deepEqual(relationTone('相破'), { tone: 'break', mark: '破' });
    assert.deepEqual(relationTone('破'), { tone: 'break', mark: '破' });
    assert.deepEqual(relationTone('三会'), { tone: 'meet', mark: '会' });
    assert.deepEqual(relationTone('干支生'), { tone: 'generate', mark: '生' });
    assert.deepEqual(relationTone('天干克'), { tone: 'control', mark: '克' });
    assert.deepEqual(relationTone('干支同气'), { tone: 'same', mark: '同' });
    assert.deepEqual(relationTone('通根'), { tone: 'root', mark: '根' });
    assert.equal(relationMode(relationTone('六冲').tone), 'relations');
    assert.equal(relationMode(relationTone('天干生').tone), 'flow');
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

test('stem–branch facts in one pillar are short vertical arrows; across pillars they bridge through the gap', () => {
    const rows: RelationRow[] = [
        { 类型: '干支生', 结果: '支生干', 说明: '日柱辰土生庚金', 位置: [cell('日柱', '天干', '庚'), cell('日柱', '地支', '辰')] },
        { 类型: '冲克', 说明: '年干甲克月支戌（示例）', 位置: [cell('年柱', '天干', '甲'), cell('月柱', '地支', '戌')] },
    ];
    const layout = layoutRelations(rows, BAZI_COLUMNS);
    const [self, across] = layout.edges;
    assert.equal(self.shape, 'vertical');
    assert.deepEqual(self.cells.map(item => item.part), ['地支', '天干'], '支生干 points from the branch up to the stem');
    assert.equal(across.shape, 'bridge');
    assert.deepEqual([across.band, across.span], ['cross', [0, 1]]);
    assert.equal(layout.lanes.cross, 1, 'the vertical and the bridge do not overlap, so the gap stays one row');
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

test('with inline relations on, an adjacent 合/害 connects directly while flow keeps a shared gap', () => {
    const rows: RelationRow[] = [
        { id: 'he', 类型: '六合', 说明: '丑子六合', 位置: [cell('月柱', '地支', '丑'), cell('日柱', '地支', '子')] },
        { id: 'hai', 类型: '相害', 说明: '子未相害', 位置: [cell('日柱', '地支', '子'), cell('时柱', '地支', '未')] },
        { id: 'chong', 类型: '天干相冲', 说明: '丁癸相冲', 位置: [cell('年柱', '天干', '丁'), cell('月柱', '天干', '癸')] },
        { id: 'ke', 类型: '天干克', 说明: '月干癸水克年干丁火', 位置: [cell('年柱', '天干', '丁'), cell('月柱', '天干', '癸')] },
        { id: 'xing', 类型: '相刑', 说明: '子卯相刑', 位置: [cell('年柱', '地支', '卯'), cell('日柱', '地支', '子')] },
    ];
    const layout = layoutRelations(rows, BAZI_COLUMNS, { inlineRelations: true });
    const shape = (id: string) => layout.edges.find(edge => edge.id === id)!.shape;
    assert.equal(shape('he'), 'inline', 'adjacent 合 connects between the glyphs');
    assert.equal(shape('hai'), 'inline', 'adjacent 害 connects between the glyphs');
    assert.equal(shape('ke'), 'inline', 'flow keeps the shared gap');
    assert.equal(shape('chong'), 'arc', 'a relation sharing a gap with flow stays a bracket');
    assert.equal(shape('xing'), 'arc', 'a pair that skips a pillar is still a bracket');
    // 详查柱位条不传这个选项，关系仍走括线。
    const strip = layoutRelations(rows, BAZI_COLUMNS);
    assert.equal(strip.edges.find(edge => edge.id === 'he')!.shape, 'arc');
});

test('a badge slides along its own line to clear another line; vertical badges stay put', () => {
    const horizontal = (x1: number, x2: number, y: number) => ({ x1, y1: y, x2, y2: y });
    const vertical = (x: number, y1: number, y2: number) => ({ x1: x, y1, x2: x, y2 });
    const items = [
        { mark: '刑', badge: { x: 50, y: 20, align: 'center' as const }, segments: [horizontal(0, 100, 20)], slide: [0, 100] as [number, number] },
        { mark: '冲', badge: { x: 50, y: 40, align: 'center' as const }, segments: [horizontal(50, 50, 40), vertical(50, 20, 40)], slide: [50, 50] as [number, number] },
        { mark: '生', badge: { x: 12, y: 20, align: 'right' as const }, segments: [vertical(12, 10, 30)] },
    ];
    const placed = placeBadges(items);
    // 子卯刑的中点正好落在丑的竖线上：徽标沿自己的横线让开。
    assert.notEqual(placed[0].badge.x, 50);
    assert.ok(placed[0].badge.x < 50 - 9 || placed[0].badge.x > 50 + 9, 'the badge clears the vertical leg');
    // 竖线的徽标没有横线可挪，留在原位。
    assert.equal(placed[2].badge.x, 12);
});

test('the layered board keeps flow brackets inside and relation brackets outside, and line legs never cross', () => {
    const rows: RelationRow[] = [
        { id: 'far', 类型: '天干生', 说明: '年干甲木生日干庚金（示例）', 位置: [cell('年柱', '天干', '甲'), cell('日柱', '天干', '庚')] },
        { id: 'hit', 类型: '天干相冲', 说明: '丙壬冲', 位置: [cell('月柱', '天干', '丙'), cell('时柱', '天干', '壬')] },
        { id: 'tie', 类型: '天干五合', 说明: '甲己合', 位置: [cell('年柱', '天干', '甲'), cell('月柱', '天干', '己')] },
    ];
    const layered = layoutRelations(rows, BAZI_COLUMNS, { layered: true });
    const lane = (id: string) => layered.edges.find(edge => edge.id === id)!.lane;
    assert.equal(lane('far'), 0, 'flow brackets take the inner lanes');
    assert.ok(lane('hit') > lane('far') && lane('tie') > lane('far'), 'relation brackets sit outside every flow bracket');
    // 不分层时（详查柱位条）关系从最内层排起。
    const strip = layoutRelations(rows.filter(row => row.id !== 'far'), BAZI_COLUMNS);
    assert.equal(strip.edges.find(edge => edge.id === 'tie')!.lane, 0);

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

test('the spotlight follows the pointer first, then what the model is looking at', () => {
    const rows: RelationRow[] = [
        { id: 'clash', 类型: '六冲', 说明: '子午冲', 位置: [cell('年柱', '地支', '子'), cell('月柱', '地支', '午')] },
        { id: 'gen', 类型: '天干生', 说明: '年干甲木生月干丙火', 位置: [cell('年柱', '天干', '甲'), cell('月柱', '天干', '丙')] },
    ];
    const { edges } = layoutRelations(rows, BAZI_COLUMNS);
    const none = new Set<string>();
    const branches = new Set(['年柱:地支', '月柱:地支']);
    assert.equal(relationSpotlight(null, edges, none, none), null, 'nothing looked at or pointed at: the board stays as drawn');
    // The model looks at 子午冲: that line and its glyphs stay lit, the rest recede.
    const viewing = relationSpotlight(null, edges, new Set(['clash']), branches)!;
    assert.deepEqual([sorted(viewing.edges), sorted(viewing.cells), sorted(viewing.tags)], [['clash'], [...branches].sort(), [...branches].sort()]);
    // A flow line without a target id is lit when both of its glyphs are looked at.
    assert.deepEqual(sorted(relationSpotlight(null, edges, new Set(['bazi:cell:0:0']), new Set(['年柱:天干', '月柱:天干']))!.edges), ['gen']);
    // Pointing at a line lights only it, even over the line the model is looking at.
    const pointed = relationSpotlight({ kind: 'edge', id: 'gen' }, edges, new Set(['clash']), branches)!;
    assert.deepEqual([sorted(pointed.edges), sorted(pointed.cells), sorted(pointed.tags)], [['gen'], ['年柱:天干', '月柱:天干'], []]);
    // Pointing at a glyph lights its lines, the glyphs at their other ends and the marks naming it.
    const glyph = relationSpotlight({ kind: 'cell', key: '年柱:地支' }, edges, none, none)!;
    assert.deepEqual([sorted(glyph.edges), sorted(glyph.cells), sorted(glyph.tags)], [['clash'], [...branches].sort(), ['年柱:地支']]);
    // A glyph without lines does not dim the board unless the model is looking at something.
    assert.equal(relationSpotlight({ kind: 'cell', key: '时柱:天干' }, edges, none, none), null);
    assert.deepEqual(sorted(relationSpotlight({ kind: 'cell', key: '时柱:天干' }, edges, new Set(['clash']), branches)!.cells), ['时柱:天干']);
    // A 根 / 透 mark lights the glyphs it names and no line.
    const spot = relationSpotlight({ kind: 'spot', cells: ['年柱:地支', '日柱:天干'] }, edges, new Set(['clash']), branches)!;
    assert.deepEqual([sorted(spot.edges), sorted(spot.cells)], [[], ['年柱:地支', '日柱:天干']]);
});

test('the board draws the chart relations and adjacent stem flow, then the wuxing pillar and stem facts', async () => {
    const chart = await structured<BaziCanonicalJSON>('bazi', birth);
    const wuxing = await structured<BaziWuxingCanonicalJSON>('bazi_wuxing', birth);
    const detail = chart.干支关系明细!;
    const none = new Set<string>();
    const plain = layoutRelations(baziBoardRows(detail, null, none), BAZI_COLUMNS, { layered: true });
    // 丑辰相破 comes with the chart itself; the relations drilldown only adds 岁运 overlays.
    assert.ok(plain.edges.some(edge => edge.mark === '破' && edge.description === '丑辰相破'));
    // Without the wuxing drilldown only adjacent stem 生克 are drawn for flow.
    assert.ok(plain.edges.every(edge => edge.mode === 'relations' || edge.span[1] - edge.span[0] === 1));
    // A located non-adjacent 生克 is kept so the model's focus is visible.
    const far = detail.find(row => row.类型 === '生' && Math.abs(BAZI_COLUMNS.indexOf(row.位置[0].柱 as '年柱') - BAZI_COLUMNS.indexOf(row.位置[1].柱 as '年柱')) > 1)!;
    assert.ok(baziBoardRows(detail, null, new Set([far.id])).some(row => row.id === far.id));
    // With the wuxing drilldown, flow uses its facts; 通根 is marked beside the hidden stems instead of drawn.
    const full = layoutRelations(baziBoardRows(detail, wuxing, none), BAZI_COLUMNS, { layered: true });
    const flow = full.edges.filter(edge => edge.mode === 'flow');
    assert.ok(flow.every(edge => edge.id.startsWith('wuxing:')));
    assert.equal(flow.filter(edge => edge.shape === 'vertical').length, 4, 'each pillar has one 干支自坐');
    assert.deepEqual(flow.filter(edge => edge.id.startsWith('wuxing:相邻天干:')).map(edge => edge.mark), ['生', '克', '同']);
    assert.equal(full.edges.some(edge => edge.tone === 'root'), false);
    assert.deepEqual(full.edges.filter(edge => edge.mode === 'relations').map(edge => edge.id), plain.edges.filter(edge => edge.mode === 'relations').map(edge => edge.id));
});

test('wuxing drilldowns feed the board only when complete and current, and partial sections add up', async () => {
    const { getLatestBaziWuxing } = await import('../components/chat/agent/bazi-board');
    const wuxing = await structured<BaziWuxingCanonicalJSON>('bazi_wuxing', birth);
    assert.equal(getLatestBaziWuxing([tool('w', 'bazi_wuxing', wuxing, 'running')]), null);
    assert.equal(getLatestBaziWuxing([tool('w', 'bazi_wuxing', { 缺失五行: [] })]), null);
    // A result of the earlier contract (no hidden stems under 月令) is not drawn.
    const month: Record<string, unknown> = { ...wuxing.月令 };
    delete month.藏干;
    assert.equal(getLatestBaziWuxing([tool('w', 'bazi_wuxing', { ...wuxing, 月令: month })]), null);
    assert.deepEqual(getLatestBaziWuxing([tool('w', 'bazi_wuxing', wuxing)]), wuxing);
    // Sections asked separately add up; 无根 travels with 通根.
    const roots = await structured<BaziWuxingCanonicalJSON>('bazi_wuxing', { ...sparse, sections: ['通根'] });
    const stems = await structured<BaziWuxingCanonicalJSON>('bazi_wuxing', { ...sparse, sections: ['相邻天干'] });
    const merged = getLatestBaziWuxing([tool('r', 'bazi_wuxing', roots), tool('s', 'bazi_wuxing', stems)])!;
    assert.deepEqual([merged.通根, merged.无根, merged.相邻天干], [roots.通根, ['年干甲木'], stems.相邻天干]);
    assert.equal(merged.干支自坐, undefined);
    assert.equal(merged.筛选, undefined, 'the merged board is no longer one filtered query');
});

test('roots and reveals are marked beside the hidden stems and name the stems they reach', async () => {
    const { baziGlyphMarks } = await import('../components/chat/agent/bazi-board');
    assert.equal(baziGlyphMarks(null), undefined);
    const marks = baziGlyphMarks(await structured<BaziWuxingCanonicalJSON>('bazi_wuxing', birth))!;
    const at = (key: string) => marks.hidden[key]?.map(mark => mark.text + (mark.detail ?? ''));
    // 巳藏庚 roots both 日主庚 and 时干辛: one mark naming both.
    assert.deepEqual(at('年柱:庚'), ['根日·时']);
    assert.deepEqual(marks.hidden['年柱:庚']![0].spot, ['年柱:地支', '日柱:天干', '时柱:天干']);
    assert.equal(marks.hidden['年柱:庚']![0].title, '年支巳藏庚（中气）：日主庚、时干辛之根');
    assert.deepEqual(at('年柱:丙'), ['根月']);
    // 丑 is the month command: 己 and 辛 surface in 年干 and 时干.
    assert.deepEqual(at('月柱:己'), ['根年', '透年']);
    assert.deepEqual(at('月柱:辛'), ['根日·时', '透时']);
    assert.deepEqual(marks.hidden['月柱:辛']![1].spot, ['月柱:地支', '时柱:天干']);
    assert.equal(at('月柱:癸'), undefined, '癸 roots no stem and stays hidden');
    assert.deepEqual(marks.stems, {}, 'every stem has a root');
    // 甲子 壬申 丙戌 癸巳: 年干甲 has no wood below it; 申藏壬 surfaces in 月干.
    const rootless = baziGlyphMarks(await structured<BaziWuxingCanonicalJSON>('bazi_wuxing', sparse))!;
    assert.deepEqual(Object.keys(rootless.stems), ['年柱']);
    assert.deepEqual(rootless.stems.年柱.map(mark => [mark.kind, mark.text, mark.spot]), [['rootless', '无根', ['年柱:天干']]]);
    assert.equal(rootless.hidden['月柱:壬']?.find(mark => mark.kind === 'reveal')?.detail, '月');
    // Without the roots group nothing can be called rootless.
    assert.deepEqual(baziGlyphMarks(await structured<BaziWuxingCanonicalJSON>('bazi_wuxing', { ...sparse, sections: ['相邻天干'] }))!.stems, {});
});

test('a relations drilldown draws its fortune strip only in the overlay contract', async () => {
    const { asBaziRelations } = await import('../components/chat/agent/bazi-board');
    const yearly = JSON.parse(JSON.stringify(await structured<BaziRelationsCanonicalJSON>('bazi_relations', { ...birth, year: 2027 })));
    assert.deepEqual(asBaziRelations(yearly), yearly);
    assert.ok(yearly.参与柱位.length > 4 && yearly.叠加关系.every((row: RelationRow) => row.位置.some(item => !BAZI_COLUMNS.includes(item.柱 as '年柱'))));
    // A result of the earlier contract listed 原局关系 and no 叠加关系.
    const legacy = { ...yearly, 原局关系: [] };
    delete legacy.叠加关系;
    assert.equal(asBaziRelations(legacy), null);
});
