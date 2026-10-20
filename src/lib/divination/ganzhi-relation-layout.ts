/**
 * 干支关系 / 五行流通的连线布局：把 Core 返回的关系行（类型 + 位置）归到天干带、地支带或干支之间，
 * 再给同一带里互相交叠的连线分配上下层（lane），供八字表与详查柱位条在盘面上画线。
 * 只读取 Core 的结构化字段，不重新判定任何关系。
 */

export type RelationPart = '天干' | '地支';
export type RelationTone = 'combine' | 'meet' | 'clash' | 'punish' | 'harm' | 'break' | 'generate' | 'control' | 'same' | 'root';
export type RelationBand = 'stem' | 'branch' | 'cross';
export type RelationMode = 'relations' | 'flow';
/**
 * arc：同一带里跨柱的括线；inline：相邻两柱同一行的两个字之间直接连线（流通的生克同气）；
 * vertical：同一柱干支之间的竖线；bridge：跨柱干支之间走行间空档的折线。
 */
export type RelationShape = 'arc' | 'inline' | 'vertical' | 'bridge';

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
    /** 连线中点的短标记：合、冲、刑、三合、生… */
    mark: string;
    /** 生 / 克等有方向：从 cells[0] 指向 cells[1]。 */
    directed: boolean;
    mode: RelationMode;
    band: RelationBand;
    shape: RelationShape;
    /** Core 的「结果」：合化五行、刑名、干生支等。 */
    result?: string;
    cells: Array<{ column: string; part: RelationPart; char: string }>;
    /** 参与的列序号（按 columns 排序）的最小与最大值；vertical 只占一列。 */
    span: [number, number];
    /** 同一带内从字形往外数的第几层，0 最靠近字形。 */
    lane: number;
}

export interface RelationLayout {
    edges: RelationEdge[];
    /** 每条带需要的层数，用来给表格留出画线的空间；cross 是干支之间那一带。 */
    lanes: Record<'stem' | 'branch' | 'cross', number>;
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

const FLOW_TONES: ReadonlySet<RelationTone> = new Set(['generate', 'control', 'same', 'root']);

/** 生克、同气、通根属于「流通」；合冲刑害破会属于「关系」。 */
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

/** 线端所在的字：「柱:部位」，与盘面字形的 data-relation-cell 一致。 */
export const relationCellKey = (cell: RelationEdge['cells'][number]) => cell.column + ':' + cell.part;

/** 悬停的对象：一条线、一个字，或藏干旁指向几个字的标记（根、透）。 */
export type RelationHover = { kind: 'edge'; id: string } | { kind: 'cell'; key: string } | { kind: 'spot'; cells: readonly string[] };

/** 聚焦时亮起的线与字；字旁的根、透、无根标记所指的字里有 tags 中的字时也亮。 */
export interface RelationSpotlight {
    edges: ReadonlySet<string>;
    cells: ReadonlySet<string>;
    tags: ReadonlySet<string>;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * 盘面此刻聚焦什么：悬停优先于 Agent 正在看的位置——指着一条线、一个字或一个根透标记时只亮它相关的，
 * Agent 看的那些也一起退后；没有悬停时亮 Agent 定位的字与线，以及两端都是定位字的流通线
 * （五行详查的自坐、相邻天干没有盘面目标 id，靠它连着的字认出来）。
 * Agent 没在看时，指着一个没有连线的字不聚焦，在盘面上随手划过不会让整盘忽明忽暗；都没有时返回 null，盘面照常。
 */
export function relationSpotlight(hover: RelationHover | null, edges: readonly RelationEdge[], located: ReadonlySet<string>, locatedCells: ReadonlySet<string>): RelationSpotlight | null {
    const viewing = located.size > 0 || locatedCells.size > 0;
    if (hover?.kind === 'edge') {
        const edge = edges.find(item => item.id === hover.id);
        return { edges: new Set([hover.id]), cells: new Set(edge?.cells.map(relationCellKey) ?? []), tags: NO_KEYS };
    }
    if (hover?.kind === 'cell') {
        const touching = edges.filter(edge => edge.cells.some(cell => relationCellKey(cell) === hover.key));
        if (touching.length || viewing) {
            return { edges: new Set(touching.map(edge => edge.id)), cells: new Set([hover.key, ...touching.flatMap(edge => edge.cells.map(relationCellKey))]), tags: new Set([hover.key]) };
        }
    }
    if (hover?.kind === 'spot') return { edges: NO_KEYS, cells: new Set(hover.cells), tags: NO_KEYS };
    if (!viewing) return null;
    const lit = edges.filter(edge => located.has(edge.id) || (edge.mode === 'flow' && edge.cells.every(cell => locatedCells.has(relationCellKey(cell)))));
    return { edges: new Set(lit.map(edge => edge.id)), cells: locatedCells, tags: locatedCells };
}

// 只有真正跨过同一列才需要换层；仅在端点相接的两条线可以共用一层，端点处的竖线由 legOffsets 左右错开。
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/**
 * 把关系行排成连线。`columns` 是盘面从左到右的柱名（年柱…时柱，或带大运、流年的详查柱位条）；
 * 位置不在这些列里的行不画。
 * `inlineRelations` 为真时，相邻两柱之间的合、害等关系也像流通一样直接连一条横线，不再绕到行外画折线；
 * 同一空档里流通优先，已有生克直连时关系仍走括线。
 * `layered` 为真时（八字盘面同时画关系与流通）流通占靠近字形的内层，关系整体排在外层，两套线不共层、不交叉。
 */
export function layoutRelations(rows: readonly RelationRow[], columns: readonly string[], options: { inlineRelations?: boolean; layered?: boolean } = {}): RelationLayout {
    const edges: RelationEdge[] = [];
    // 两个字之间的空档只放一条直连线；先让流通占位，关系再填剩下的空档。
    const adjacentSlot = (row: RelationRow) => {
        if (row.位置.length !== 2) return null;
        const parts = new Set(row.位置.map(cell => cell.部位));
        if (parts.size !== 1) return null;
        const positions = row.位置.map(cell => columns.indexOf(cell.柱));
        if (positions.some(position => position < 0)) return null;
        const span: [number, number] = [Math.min(...positions), Math.max(...positions)];
        if (span[1] - span[0] !== 1) return null;
        return { slot: (parts.has('天干') ? 'stem' : 'branch') + ':' + span[0] };
    };
    const flowSlots = new Set<string>();
    for (const row of rows) {
        if (relationMode(relationTone(row.类型, row.位置.length).tone) !== 'flow') continue;
        const candidate = adjacentSlot(row);
        if (candidate) flowSlots.add(candidate.slot);
    }
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
            directed: ['generate', 'control', 'root'].includes(tone),
            mode: relationMode(tone),
            ...(row.结果 ? { result: row.结果 } : {}),
            cells,
            lane: 0,
        };
        if (parts.size === 1) {
            const band = parts.has('天干') ? 'stem' : 'branch';
            const span: [number, number] = [Math.min(...positions), Math.max(...positions)];
            // 相邻两柱的生克同气直接连一条横线；合、害等相邻关系在空档空闲时也直连，隔柱的线仍走括线。
            const slot = band + ':' + span[0];
            const adjacent = cells.length === 2 && span[1] - span[0] === 1 && !inlineSlots.has(slot);
            const inline = adjacent && (base.mode === 'flow' ? flowSlots.has(slot) : options.inlineRelations === true && !flowSlots.has(slot));
            if (inline) inlineSlots.add(slot);
            edges.push({ ...base, band, shape: inline ? 'inline' : 'arc', span });
            return;
        }
        // 干支之间：同一柱画短竖箭头，跨柱走行间空档的折线；箭头方向由 cells 的「来源 → 结果」决定。
        const sameColumn = new Set(positions).size === 1;
        edges.push(sameColumn
            ? { ...base, band: 'cross', shape: 'vertical', span: [positions[0], positions[0]] }
            : { ...base, band: 'cross', shape: 'bridge', span: [Math.min(...positions), Math.max(...positions)] });
    });
    return assignLanes(edges, options.layered === true);
}

/** 同一带里跨度短的先排，与已排的线交叠就往外一层；`layered` 见 layoutRelations。 */
function assignLanes(edges: RelationEdge[], layered: boolean): RelationLayout {
    const lanes = { stem: 0, branch: 0, cross: 0 };
    const groups: Array<(edge: RelationEdge) => boolean> = layered ? [edge => edge.mode === 'flow', edge => edge.mode === 'relations'] : [() => true];
    for (const band of ['stem', 'branch', 'cross'] as const) {
        for (const inGroup of groups) {
            const base = lanes[band];
            const placed: RelationEdge[] = [];
            // 字间直连线不占层。
            const order = edges.filter(edge => edge.band === band && edge.shape !== 'inline' && inGroup(edge))
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
    return { edges, lanes };
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
        // 字间直连线没有竖脚。
        if (edge.shape === 'inline') continue;
        if (edge.shape === 'vertical') {
            push(edge.cells[0].column + ':vertical', { key: edge.id + '@0', lane: edge.lane, side: 0 });
            continue;
        }
        const xs = edge.cells.map(x);
        edge.cells.forEach((cell, index) => {
            const own = xs[index];
            const others = xs.filter((value, other): value is number => other !== index && value !== undefined);
            const side = own === undefined || !others.length ? 0 : others.every(value => value < own) ? -1 : others.every(value => value > own) ? 1 : 0;
            // 折线从天干往下、从地支往上，与同一字上方 / 下方的括线分开排脚。
            push(cell.column + ':' + cell.part + (edge.shape === 'bridge' ? ':cross' : ''), { key: edge.id + '@' + index, lane: edge.lane, side });
        });
    }
    const slots = new Map<string, number>();
    for (const legs of byCell.values()) {
        legs.sort((a, b) => a.side - b.side || (a.side > 0 ? b.lane - a.lane : a.lane - b.lane))
            .forEach((leg, index) => slots.set(leg.key, index - (legs.length - 1) / 2));
    }
    return slots;
}

/** 徽标在盘面上的位置：center 以 x 居中，right 以 x 为右缘（竖线的徽标放在线左侧）。 */
export type BadgePlacement = { x: number; y: number; align: 'center' | 'right' };
export type BadgeSegment = { x1: number; y1: number; x2: number; y2: number };
/** 已算好线段的徽标：mark 决定宽度估计，segments 是这条线画出的各段，slide 是徽标可沿横线移动的范围。 */
export interface BadgeCandidate {
    mark: string;
    badge: BadgePlacement;
    segments: readonly BadgeSegment[];
    slide?: [number, number];
}

const BADGE_HEIGHT = 14;
/** 避让时给徽标四周再留出的空隙，保证和别的线、别的徽标隔开一点。 */
const BADGE_CLEARANCE = 5;
/** 徽标宽度按字数估：10px 字号，中文约 10px 一个字，再留内边距。 */
const badgeWidth = (mark: string) => Math.max(16, [...mark].length * 10 + 8);
type Rect = { left: number; top: number; right: number; bottom: number };
const badgeRect = (badge: BadgePlacement, width: number, margin = 0): Rect => badge.align === 'right'
    ? { left: badge.x - width - margin, top: badge.y - BADGE_HEIGHT / 2 - margin, right: badge.x + margin, bottom: badge.y + BADGE_HEIGHT / 2 + margin }
    : { left: badge.x - width / 2 - margin, top: badge.y - BADGE_HEIGHT / 2 - margin, right: badge.x + width / 2 + margin, bottom: badge.y + BADGE_HEIGHT / 2 + margin };
const overlapsRect = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
/** 各段都是横线或竖线，矩形与线段的相交判断因此很简单。 */
function hitsSegment(rect: Rect, segment: BadgeSegment) {
    if (segment.y1 === segment.y2) {
        return segment.y1 >= rect.top && segment.y1 <= rect.bottom
            && Math.max(segment.x1, segment.x2) >= rect.left && Math.min(segment.x1, segment.x2) <= rect.right;
    }
    return segment.x1 >= rect.left && segment.x1 <= rect.right
        && Math.max(segment.y1, segment.y2) >= rect.top && Math.min(segment.y1, segment.y2) <= rect.bottom;
}

/**
 * 徽标压到别的线时，沿自己的横线左右挪到空处（例如子卯刑的「刑」不再压在冲、刑的竖线上）。
 * 竖线的徽标没有横线可挪，保持原位；实在找不到空处也保持原位。
 */
export function placeBadges<T extends BadgeCandidate>(drawn: readonly T[]): T[] {
    const placed: Rect[] = [];
    return drawn.map(item => {
        const width = badgeWidth(item.mark);
        const rectAt = (x: number) => badgeRect({ ...item.badge, x }, width, BADGE_CLEARANCE);
        const blocked = (rect: Rect) => drawn.some(other => other !== item && other.segments.some(segment => hitsSegment(rect, segment)))
            || placed.some(other => overlapsRect(rect, other));
        let x = item.badge.x;
        if (item.badge.align === 'center' && item.slide) {
            const [min, max] = item.slide;
            const low = Math.min(min + width / 2, max - width / 2), high = Math.max(min + width / 2, max - width / 2);
            const center = (min + max) / 2;
            for (let step = 0; step <= 60; step += 1) {
                const found = (step === 0 ? [0] : [step * 8, -step * 8])
                    .map(delta => Math.min(high, Math.max(low, center + delta)))
                    .find(candidate => !blocked(rectAt(candidate)));
                if (found !== undefined) { x = found; break; }
            }
        }
        placed.push(rectAt(x));
        return { ...item, badge: { ...item.badge, x } };
    });
}

export const BAZI_COLUMNS = ['年柱', '月柱', '日柱', '时柱'] as const;

/** 五行详查里画成连线的两组事实；通根与月令透出标在藏干旁（见 bazi-board 的 baziGlyphMarks）。 */
const WUXING_GROUPS = ['相邻天干', '干支自坐'] as const;
type WuxingRows = Partial<Record<typeof WUXING_GROUPS[number], readonly RelationRow[]>>;

/**
 * 八字表上要画的全部关系行。
 * - 合冲刑害破会：命盘的干支关系明细全部给出（原局关系只在命盘里，岁运叠加不在原局四柱上画）。
 * - 生克：没有五行详查时只取相邻两柱的天干；五行详查给出相邻天干后改用它（含同气，口径更完整），
 *   再补上详查给出的干支自坐。按 sections 只取了部分事实组时，没给的组照旧。
 * 模型定位过的生克行始终保留，保证定位能在盘面上看到。
 */
export function baziBoardRows(detail: readonly RelationRow[], wuxing: WuxingRows | null, located: ReadonlySet<string>): RelationRow[] {
    const rows: RelationRow[] = [];
    for (const row of detail) {
        const tone = relationTone(row.类型, row.位置.length).tone;
        if (relationMode(tone) === 'relations') { rows.push(row); continue; }
        const columns = row.位置.map(cell => BAZI_COLUMNS.indexOf(cell.柱 as typeof BAZI_COLUMNS[number]));
        const adjacent = columns.length === 2 && columns.every(column => column >= 0) && Math.abs(columns[0] - columns[1]) === 1;
        if (located.has(row.id ?? '') || (!wuxing?.相邻天干 && adjacent)) rows.push(row);
    }
    const cellsKey = (row: RelationRow) => row.位置.map(cell => cell.柱 + cell.部位).sort().join('|');
    const keyOf = (row: RelationRow) => relationTone(row.类型, row.位置.length).mark + '@' + cellsKey(row);
    // 同一关系（同类型、同一组字）已经画出时不重复：模型定位过的命盘生克与详查的相邻天干可能是同一条。
    const drawn = new Set(rows.map(keyOf));
    if (wuxing) for (const group of WUXING_GROUPS) {
        (wuxing[group] ?? []).forEach((row, index) => {
            if (drawn.has(keyOf(row))) return;
            rows.push({ ...row, id: `wuxing:${group}:${index}` });
        });
    }
    return rows;
}
