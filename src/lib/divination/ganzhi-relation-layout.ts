/**
 * 干支关系 / 五行流通的连线布局：把 Core 返回的关系行（类型 + 位置）归到天干带、地支带或干支之间，
 * 再给同一带里互相交叠的连线分配上下层（lane），供八字表与详查柱位条在盘面上画线。
 * 只读取 Core 的结构化字段，不重新判定任何关系。
 */

export type RelationPart = '天干' | '地支';
export type RelationTone = 'combine' | 'meet' | 'clash' | 'punish' | 'harm' | 'break' | 'generate' | 'control' | 'same' | 'root' | 'reveal';
export type RelationBand = 'stem' | 'branch' | 'cross';
export type RelationMode = 'relations' | 'flow';
/**
 * arc：同一带里跨柱的括线；inline：相邻两柱同一行的两个字之间直接连线（流通的生克同气）；
 * vertical：同一柱干支之间的竖线；bridge：跨柱干支之间走行间空档的折线；marker：只标在一个字旁的徽标。
 */
export type RelationShape = 'arc' | 'inline' | 'vertical' | 'bridge' | 'marker';

/** Core 关系行的公共形状：八字命盘的干支关系明细、bazi_relations 与 bazi_wuxing 的各类事实都是它。 */
export interface RelationRow {
    id?: string;
    类型: string;
    说明: string;
    结果?: string;
    位置: Array<{ 柱: string; 部位: RelationPart; 字: string }>;
}

export interface RelationEdge {
    /** 盘面目标 id（干支关系明细有）或按行序生成的稳定 id。 */
    id: string;
    type: string;
    description: string;
    tone: RelationTone;
    /** 连线中点的短标记：合、冲、刑、三合、根… */
    mark: string;
    /** 生 / 克 / 通根等有方向：从 cells[0] 指向 cells[1]。 */
    directed: boolean;
    mode: RelationMode;
    band: RelationBand;
    shape: RelationShape;
    /** Core 的「结果」：合化五行、刑名、本气 / 中气 / 余气、干生支等。 */
    result?: string;
    cells: Array<{ column: string; part: RelationPart; char: string }>;
    /** marker 标在哪个字旁：通根标在地支，透干标在天干。 */
    anchor?: { column: string; part: RelationPart; char: string };
    /** 参与的列序号（按 columns 排序）的最小与最大值；marker 与 vertical 只占一列。 */
    span: [number, number];
    /** 同一带内从字形往外数的第几层，0 最靠近字形。 */
    lane: number;
}

export interface RelationLayout {
    edges: RelationEdge[];
    /** 每条带需要的层数，用来给表格留出画线的空间；cross 是干支之间那一带。 */
    lanes: Record<'stem' | 'branch' | 'cross', number>;
    /** 模型定位过、但不属于当前模式的线：不画线，只在结果字旁留一个聚合标记。 */
    aside?: RelationEdge[];
}

const TONES: Array<[RegExp, RelationTone, string]> = [
    [/^(三会)$/u, 'meet', '会'],
    [/^(三合)$/u, 'combine', '三合'],
    [/^(半合)$/u, 'combine', '半合'],
    [/^(合|六合|天干五合)$/u, 'combine', '合'],
    [/^(冲|冲克|六冲|天干相冲)$/u, 'clash', '冲'],
    [/^(刑|相刑|自刑)$/u, 'punish', '刑'],
    [/^(害|相害)$/u, 'harm', '害'],
    [/^(破|相破)$/u, 'break', '破'],
    [/^通根$/u, 'root', '根'],
    [/^透干$/u, 'reveal', '透'],
    [/(^|天干|干支)生$/u, 'generate', '生'],
    [/(^|天干|干支)克$/u, 'control', '克'],
    [/(^|天干|干支)同气$/u, 'same', '同'],
];

/** 关系类型的连线样式；未知类型按普通关系画，不丢弃。 */
export function relationTone(type: string, cellCount = 2): { tone: RelationTone; mark: string } {
    const found = TONES.find(([pattern]) => pattern.test(type));
    if (!found) return { tone: 'combine', mark: type.slice(0, 2) };
    // 八字命盘把三合也记作「合」，按参与地支数区分。
    if (found[1] === 'combine' && found[2] === '合' && cellCount >= 3) return { tone: 'combine', mark: '三合' };
    return { tone: found[1], mark: found[2] };
}

const FLOW_TONES: ReadonlySet<RelationTone> = new Set(['generate', 'control', 'same', 'root', 'reveal']);

/** 生克、通根、透干、同气属于「流通」；合冲刑害破会属于「关系」。 */
export function relationMode(tone: RelationTone): RelationMode {
    return FLOW_TONES.has(tone) ? 'flow' : 'relations';
}

/**
 * 把两个字的顺序排成「来源 → 结果」，箭头才指得对：
 * - 干支自坐用「结果」说明方向（支生干 / 支克干时从地支指向天干）；
 * - 相邻天干（以及命盘里的生 / 克）按说明里动词前的字取来源，如「月干癸水克年干丁火」。
 */
function orderedCells(row: RelationRow) {
    const cells = row.位置.map(cell => ({ column: cell.柱, part: cell.部位, char: cell.字 }));
    if (cells.length !== 2) return cells;
    if (/^支(生|克)干$/u.test(row.结果 ?? '') && cells[0].part === '天干') return [cells[1], cells[0]];
    if (/^(天干)?(生|克)$/u.test(row.类型)) {
        const verb = row.说明.search(/[生克]/u);
        const source = verb > 0 ? cells.find(cell => row.说明.slice(0, verb).includes(cell.char)) : undefined;
        if (source && source !== cells[0]) return [source, cells.find(cell => cell !== source)!];
    }
    return cells;
}

// 只有真正跨过同一列才需要换层；仅在端点相接的两条线可以共用一层，端点处的竖线由 legOffsets 左右错开。
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/**
 * 把关系行排成连线。`columns` 是盘面从左到右的柱名（年柱…时柱，或带大运、流年的详查柱位条）；
 * 位置不在这些列里的行不画。
 */
export function layoutRelations(rows: readonly RelationRow[], columns: readonly string[]): RelationLayout {
    const edges: RelationEdge[] = [];
    // 两个字之间的空档只放一条直连线；同一空档再有一条就退回括线，免得叠在一起。
    const inlineSlots = new Set<string>();
    rows.forEach((row, index) => {
        const cells = orderedCells(row);
        if (cells.length < 2) return;
        const positions = cells.map(cell => columns.indexOf(cell.column));
        if (positions.some(position => position < 0)) return;
        const parts = new Set(cells.map(cell => cell.part));
        const { tone, mark } = relationTone(row.类型, cells.length);
        const base = {
            id: row.id ?? `relation-${index}`,
            type: row.类型,
            description: row.说明,
            tone,
            mark,
            directed: ['generate', 'control', 'root', 'reveal'].includes(tone),
            mode: relationMode(tone),
            ...(row.结果 ? { result: row.结果 } : {}),
            cells,
            lane: 0,
        };
        if (parts.size === 1) {
            const band = parts.has('天干') ? 'stem' : 'branch';
            const span: [number, number] = [Math.min(...positions), Math.max(...positions)];
            // 相邻两柱的生克同气：两个字并排，直接连一条横线；合冲刑害与隔柱的线仍走括线。
            const slot = band + ':' + span[0];
            const inline = base.mode === 'flow' && cells.length === 2 && span[1] - span[0] === 1 && !inlineSlots.has(slot);
            if (inline) inlineSlots.add(slot);
            edges.push({ ...base, band, shape: inline ? 'inline' : 'arc', span });
            return;
        }
        // 干支之间：同一柱画短竖箭头；跨柱的通根 / 透干不画穿行长线，改成目标字旁的聚合标记，
        // 避免多条线挤在天干与地支之间。箭头方向仍由 cells 的「来源 → 结果」决定。
        const sameColumn = new Set(positions).size === 1;
        if (sameColumn) edges.push({ ...base, band: 'cross', shape: 'vertical', span: [positions[0], positions[0]] });
        else edges.push({ ...base, band: 'cross', shape: 'marker', anchor: cells[cells.length - 1], span: [positions[positions.length - 1], positions[positions.length - 1]] });
    });
    return assignLanes(edges);
}

/**
 * 同一带里跨度短的先排，与已排的线交叠就往外一层。
 * `layered` 时（关系与流通同时显示）流通线占靠近字形的内层，关系线整体排在流通线之外，两套线不共层、不交叉。
 */
function assignLanes(edges: RelationEdge[], layered = false): RelationLayout {
    const lanes = { stem: 0, branch: 0, cross: 0 };
    const groups: Array<(edge: RelationEdge) => boolean> = layered ? [edge => edge.mode === 'flow', edge => edge.mode === 'relations'] : [() => true];
    for (const band of ['stem', 'branch', 'cross'] as const) {
        for (const inGroup of groups) {
            const base = lanes[band];
            const placed: RelationEdge[] = [];
            // 字旁标记与字间直连线都不占层。
            const order = edges.filter(edge => edge.band === band && edge.shape !== 'marker' && edge.shape !== 'inline' && inGroup(edge))
                .sort((a, b) => (a.span[1] - a.span[0]) - (b.span[1] - b.span[0]) || a.span[0] - b.span[0]);
            for (const edge of order) {
                let lane = base;
                while (placed.some(other => other.lane === lane && overlaps(other.span, edge.span))) lane++;
                edge.lane = lane;
                placed.push(edge);
                lanes[band] = Math.max(lanes[band], lane + 1);
            }
        }
    }
    // 通根 / 透干画在干支之间的空档里，即使没有同柱生克也要留出一层放标记。
    if (edges.some(edge => edge.shape === 'marker')) lanes.cross = Math.max(lanes.cross, 1);
    return { edges, lanes };
}

/**
 * 只留当前模式与筛选要画的线。「全部」同时画关系与流通（分层见 assignLanes）。模型定位过的线在所属模式里始终保留；
 * 若模型定位的是另一种模式的关系，则在当前模式里收成一个字旁标记（aside），不让两套线叠在一起。
 * 选择「不显示」时盘面不画线，定位信息仍由盘面上方的说明与位置标签承接。
 */
export function visibleRelationEdges(layout: RelationLayout, mode: RelationMode | 'all' | 'off', hiddenMarks: ReadonlySet<string>, located: ReadonlySet<string>): RelationLayout {
    if (mode === 'off') return { edges: [], lanes: { stem: 0, branch: 0, cross: 0 }, aside: [] };
    if (mode === 'all') {
        const edges = layout.edges.filter(edge => !hiddenMarks.has(edge.mark) || located.has(edge.id));
        return { ...assignLanes(edges.map(edge => ({ ...edge, lane: 0 })), true), aside: [] };
    }
    const edges = layout.edges.filter(edge => edge.mode === mode && (!hiddenMarks.has(edge.mark) || located.has(edge.id)));
    const aside = layout.edges.filter(edge => edge.mode !== mode && located.has(edge.id));
    // 隐藏一部分线后重新分层，外层不留空档。
    const visible = assignLanes(edges.map(edge => ({ ...edge, lane: 0 })));
    // 旁置标记放在当前模式的最后一层线之外，不与线抢位置。
    const bands = new Set(aside.map(edge => edge.cells[edge.cells.length - 1].part === '天干' ? 'stem' as const : 'branch' as const));
    for (const band of bands) visible.lanes[band] += 1;
    return { ...visible, aside };
}

/**
 * 一个字上落着几条线时，各条线脚的左右次序（「edge.id@cell 序号」→ 槽位，以一个间距为单位、以 0 为中）。
 * 往左去的线在左、往右去的在右；往左的内层靠左外层靠右，往右的外层靠左内层靠右。
 * 这样嵌套的括线在字的上方（或下方）互不交叉，关系与流通同时显示也不会互相穿过。
 * 同柱的干支竖线按柱单独成组；`x` 给出字的横坐标（盘面上量得的中心，或测试里的列序）。
 */
export function relationLegSlots(edges: readonly RelationEdge[], x: (cell: RelationEdge['cells'][number]) => number | undefined): Map<string, number> {
    type Leg = { key: string; lane: number; side: number };
    const byCell = new Map<string, Leg[]>();
    const push = (cell: string, leg: Leg) => byCell.set(cell, [...(byCell.get(cell) ?? []), leg]);
    for (const edge of edges) {
        // 根 / 透只进字旁的聚合标记，字间直连线也没有竖脚。
        if (edge.shape === 'marker' || edge.shape === 'inline' || (edge.shape === 'vertical' && (edge.tone === 'root' || edge.tone === 'reveal'))) continue;
        if (edge.shape === 'vertical') {
            push(edge.cells[0].column + ':vertical', { key: edge.id + '@0', lane: edge.lane, side: 0 });
            continue;
        }
        const xs = edge.cells.map(x);
        edge.cells.forEach((cell, index) => {
            const own = xs[index];
            const others = xs.filter((value, other): value is number => other !== index && value !== undefined);
            const side = own === undefined || !others.length ? 0 : others.every(value => value < own) ? -1 : others.every(value => value > own) ? 1 : 0;
            push(cell.column + ':' + cell.part, { key: edge.id + '@' + index, lane: edge.lane, side });
        });
    }
    const slots = new Map<string, number>();
    for (const legs of byCell.values()) {
        legs.sort((a, b) => a.side - b.side || (a.side > 0 ? b.lane - a.lane : a.lane - b.lane))
            .forEach((leg, index) => slots.set(leg.key, index - (legs.length - 1) / 2));
    }
    return slots;
}

export const BAZI_COLUMNS = ['年柱', '月柱', '日柱', '时柱'] as const;

/** 五行详查里会画到盘上的四组事实；五行统计、月令等由五行环与详查区展示。 */
const WUXING_GROUPS = ['相邻天干', '干支自坐', '通根', '透干'] as const;
type WuxingRows = Partial<Record<typeof WUXING_GROUPS[number], readonly RelationRow[]>>;

/**
 * 八字表上要画的全部关系行。
 * - 合冲刑害会：命盘的干支关系明细全部给出，再补上关系详查（bazi_relations）原局里命盘没列的（如相破）。
 * - 生克：没有五行详查时只取相邻两柱的天干；做过五行详查后改用它的相邻天干、干支自坐、通根、透干（含同气，口径更完整）。
 * 模型定位过的生克行始终保留，保证定位能在盘面上看到。
 */
export function baziBoardRows(detail: readonly RelationRow[], drilldowns: { relations?: readonly RelationRow[] | null; wuxing?: WuxingRows | null }, located: ReadonlySet<string>): RelationRow[] {
    const { relations, wuxing } = drilldowns;
    const rows: RelationRow[] = [];
    for (const row of detail) {
        const tone = relationTone(row.类型, row.位置.length).tone;
        if (relationMode(tone) === 'relations') { rows.push(row); continue; }
        const columns = row.位置.map(cell => BAZI_COLUMNS.indexOf(cell.柱 as typeof BAZI_COLUMNS[number]));
        const adjacent = columns.length === 2 && columns.every(column => column >= 0) && Math.abs(columns[0] - columns[1]) === 1;
        if (located.has(row.id ?? '') || (!wuxing && adjacent)) rows.push(row);
    }
    const cellsKey = (row: RelationRow) => row.位置.map(cell => cell.柱 + cell.部位).sort().join('|');
    const keyOf = (row: RelationRow) => relationTone(row.类型, row.位置.length).mark + '@' + cellsKey(row);
    // 同一关系（同类型、同一组字）已经画出时不重复：命盘与关系详查都会列出六合、六冲等。
    const drawn = new Set(rows.map(keyOf));
    (relations ?? []).forEach((row, index) => {
        if (drawn.has(keyOf(row))) return;
        drawn.add(keyOf(row));
        rows.push({ ...row, id: `relations:${index}` });
    });
    if (wuxing) for (const group of WUXING_GROUPS) {
        (wuxing[group] ?? []).forEach((row, index) => {
            if (drawn.has(keyOf(row))) return;
            rows.push({ ...row, id: `wuxing:${group}:${index}` });
        });
    }
    return rows;
}
