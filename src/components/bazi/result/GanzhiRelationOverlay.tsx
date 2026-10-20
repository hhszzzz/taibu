'use client';
// 需要测量字形位置（ResizeObserver）并保存悬停状态，才能把干支关系画在表上

import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    placeBadges, relationLegSlots, relationSpotlight,
    type BadgePlacement, type BadgeSegment, type RelationEdge, type RelationHover, type RelationLayout, type RelationTone,
} from '@/lib/divination/ganzhi-relation-layout';

/** 每层连线的高度（px）；表格按层数给天干行上方、地支行下方留白。 */
export const RELATION_LANE = 16;
const GLYPH_GAP = 3;

export function relationBandHeight(lanes: number) {
    return lanes > 0 ? lanes * RELATION_LANE + GLYPH_GAP : 0;
}

/** 干支之间的空档：要放下一支完整的竖箭头与它左侧的生克徽标，所以固定比连线层高。 */
const CROSS_BAND = 30;
export function relationCrossHeight(lanes: number) {
    return lanes > 0 ? CROSS_BAND : 0;
}

const TONE_COLOR: Record<RelationTone, string> = {
    combine: 'var(--success)', meet: 'var(--success)', generate: 'var(--success)',
    clash: 'var(--danger)', control: 'var(--danger)',
    punish: 'var(--warning)', harm: 'var(--accent-strong)', break: 'var(--foreground-secondary)',
    same: 'var(--foreground-tertiary)', root: 'var(--accent)',
};
/** 线型区分类型（色弱时也能分辨）：合会生实线，冲克粗线，刑虚线，害点线，破点划线，同气细点线。 */
const TONE_DASH: Partial<Record<RelationTone, string>> = { punish: '5 3', harm: '1 3', break: '6 2 1 2', same: '1 3' };

type Box = { left: number; top: number; right: number; bottom: number; cx: number; cy: number };

/** 盘面上字形的位置，相对于叠加层自身（叠加层随表格一起横向滚动，不需要监听滚动）。 */
function measure(root: HTMLElement) {
    const host = root.parentElement;
    const boxes = new Map<string, Box>();
    if (!host) return { boxes, width: 0, height: 0 };
    const origin = root.getBoundingClientRect();
    host.querySelectorAll<HTMLElement>('[data-relation-cell]').forEach(node => {
        const rect = node.getBoundingClientRect();
        const left = rect.left - origin.left, top = rect.top - origin.top;
        boxes.set(node.dataset.relationCell!, { left, top, right: left + rect.width, bottom: top + rect.height, cx: left + rect.width / 2, cy: top + rect.height / 2 });
    });
    return { boxes, width: host.scrollWidth, height: host.scrollHeight };
}

type Geometry = {
    path: string;
    badge: BadgePlacement;
    /** 这条线画出的各段，用来把徽标挪开其他线。 */
    segments: BadgeSegment[];
    /** 徽标可以沿着自己的横线左右移动的范围。 */
    slide?: [number, number];
};

/** 一条关系的线与徽标位置；字形缺失（如时辰未知）时不画。 */
function geometry(edge: RelationEdge, boxes: Map<string, Box>, offsets: Map<string, number>): Geometry | null {
    const at = (cell: RelationEdge['cells'][number]) => boxes.get(cell.column + ':' + cell.part);
    const cells = edge.cells.map(at);
    if (cells.some(box => !box)) return null;
    const placed = cells as Box[];
    const offset = (index: number) => offsets.get(edge.id + '@' + index) ?? 0;
    // 干支之间：走天干与地支之间的空档，箭头从来源指向结果，不再用贴字的徽标。
    if (edge.shape === 'vertical' || edge.shape === 'bridge') {
        const stemIndex = edge.cells.findIndex(cell => cell.part === '天干');
        const branchIndex = edge.cells.findIndex(cell => cell.part === '地支');
        if (stemIndex < 0 || branchIndex < 0) return null;
        const gapTop = placed[stemIndex].bottom + GLYPH_GAP;
        const gapBottom = placed[branchIndex].top - GLYPH_GAP;
        // 起点离字 2px；有箭头的一侧留 8px 给箭头，箭头本身不压到字形。没有箭头的线两端留一样的空。
        const exitY = (index: number, target: boolean) => {
            const gap = target && edge.directed ? 8 : 2;
            return edge.cells[index].part === '天干' ? placed[index].bottom + gap : placed[index].top - gap;
        };
        const x0 = placed[0].cx + offset(0), x1 = placed[1].cx + offset(1);
        const y0 = exitY(0, false), y1 = exitY(1, true);
        if (edge.shape === 'vertical') {
            // 同一柱的干支自坐：一支竖箭头在字形中线上，徽标放在箭头左侧，不压住箭身。
            return {
                path: `M${x0} ${y0} V${y1}`, badge: { x: x0 - 6, y: (gapTop + gapBottom) / 2, align: 'right' },
                segments: [{ x1: x0, y1: y0, x2: x0, y2: y1 }],
            };
        }
        const y = Math.min(gapTop + edge.lane * RELATION_LANE + RELATION_LANE / 2, Math.max(gapTop + 2, gapBottom - 2));
        return {
            path: `M${x0} ${y0} V${y} H${x1} V${y1}`, badge: { x: (x0 + x1) / 2, y, align: 'center' },
            segments: [
                { x1: x0, y1: y0, x2: x0, y2: y },
                { x1: x0, y1: y, x2: x1, y2: y },
                { x1: x1, y1: y, x2: x1, y2: y1 },
            ],
            slide: [Math.min(x0, x1), Math.max(x0, x1)],
        };
    }
    // 相邻两字之间直接连一条横线：从来源字的边缘到结果字的边缘，箭头停在结果字前，不压字。
    if (edge.shape === 'inline') {
        const [from, to] = placed;
        const rightward = to.cx > from.cx;
        const y = (from.cy + to.cy) / 2;
        const x0 = rightward ? from.right + 4 : from.left - 4;
        const x1 = rightward ? to.left - (edge.directed ? 6 : 4) : to.right + (edge.directed ? 6 : 4);
        return {
            path: `M${x0} ${y} H${x1}`, badge: { x: (x0 + x1) / 2, y, align: 'center' },
            segments: [{ x1: x0, y1: y, x2: x1, y2: y }],
            slide: [Math.min(x0, x1), Math.max(x0, x1)],
        };
    }
    const part = edge.cells[0].part;
    // 同一带里的线取所有参与字的极值：日主、日支等较大的字不会把线挤得贴住字形，两端线脚也等长。
    const y = part === '天干'
        ? Math.min(...placed.map(box => box.top)) - GLYPH_GAP - edge.lane * RELATION_LANE - RELATION_LANE / 2
        : Math.max(...placed.map(box => box.bottom)) + GLYPH_GAP + edge.lane * RELATION_LANE + RELATION_LANE / 2;
    // 起点离字 2px；有箭头的一侧留 8px 给箭头，箭头本身不会压到字形。无箭头的线两端留一样的空。
    const glyphStart = (box: Box) => part === '天干' ? box.top - 2 : box.bottom + 2;
    const glyphEnd = (box: Box) => part === '天干' ? box.top - 8 : box.bottom + 8;
    const xs = placed.map((_, index) => placed[index].cx + offset(index));
    const legEnd = (box: Box, index: number) => edge.directed && index === placed.length - 1 ? glyphEnd(box) : glyphStart(box);
    // 有方向的线画成一笔，终点落在被生 / 被克的字上，箭头才指得对。
    const path = edge.directed && placed.length === 2
        ? `M${xs[0]} ${glyphStart(placed[0])} V${y} H${xs[1]} V${glyphEnd(placed[1])}`
        : [`M${Math.min(...xs)} ${y} H${Math.max(...xs)}`, ...placed.map((box, index) => `M${xs[index]} ${legEnd(box, index)} V${y}`)].join(' ');
    return {
        path, badge: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y, align: 'center' },
        segments: [
            { x1: Math.min(...xs), y1: y, x2: Math.max(...xs), y2: y },
            ...placed.map((box, index) => ({ x1: xs[index], y1: legEnd(box, index), x2: xs[index], y2: y })),
        ],
        slide: [Math.min(...xs), Math.max(...xs)],
    };
}

/** 同一个字上相邻两条线脚的间距（px）。 */
const LEG_GAP = 7;
const NO_CELLS: ReadonlySet<string> = new Set();

/** 悬停状态；标记悬停时记下标记本身，聚焦时它和所指的字一起保持明亮。 */
type Hover = RelationHover & { node?: Element };
const sameHover = (a: Hover | null, b: Hover | null) => a === b || (!!a && !!b && a.kind === b.kind
    && (a.kind === 'edge' ? a.id === (b as typeof a).id : a.kind === 'cell' ? a.key === (b as typeof a).key : a.node === b.node));

/**
 * 画在八字表（或详查柱位条）上的干支关系层：天干之间的线在天干行上方，地支之间的在地支行下方，
 * 同柱干支的生克画在干支之间。点徽标交给 onSelect（Agent 里是追问这条关系）。
 * 线默认是淡的。Agent 正在看时只亮它定位的字与线，其余的线、字与根透标记退后；指着一条线、一个字或藏干旁的
 * 根透标记时，只亮与之相关的，Agent 看的那些也一起退后，移开即恢复（见 relationSpotlight）。
 */
export function GanzhiRelationOverlay({ layout, located, locatedCells = NO_CELLS, onSelect }: {
    layout: RelationLayout;
    /** Agent 定位到的线（盘面目标 id）。 */
    located: ReadonlySet<string>;
    /** Agent 定位到的字（「柱:部位」）；两端都在其中的流通线也算在看。 */
    locatedCells?: ReadonlySet<string>;
    onSelect?: (edge: RelationEdge) => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const [measured, setMeasured] = useState<ReturnType<typeof measure> | null>(null);
    const [hover, setHoverState] = useState<Hover | null>(null);
    const setHover = useCallback((next: Hover | null) => setHoverState(current => sameHover(current, next) ? current : next), []);
    const remeasure = useCallback(() => { if (rootRef.current) setMeasured(measure(rootRef.current)); }, []);
    useLayoutEffect(() => {
        const root = rootRef.current;
        const host = root?.parentElement;
        if (!root || !host) return;
        remeasure();
        const observer = new ResizeObserver(remeasure);
        observer.observe(host);
        if (host.firstElementChild) observer.observe(host.firstElementChild);
        // 衬线字体晚到会改变字宽。
        void document.fonts?.ready.then(remeasure);
        return () => observer.disconnect();
    }, [remeasure, layout]);
    // 盘面的字与藏干旁的根透标记不在关系层里：在宿主上委托悬停。徽标与线在关系层内，自己处理。
    useLayoutEffect(() => {
        const root = rootRef.current;
        const host = root?.parentElement;
        if (!root || !host) return;
        const over = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target || root.contains(target)) return;
            const spot = target.closest<HTMLElement>('[data-relation-spot]');
            const cell = target.closest<HTMLElement>('[data-relation-cell]');
            if (spot && host.contains(spot)) setHover({ kind: 'spot', cells: (spot.dataset.relationSpot ?? '').split(' ').filter(Boolean), node: spot });
            else if (cell && host.contains(cell)) setHover({ kind: 'cell', key: cell.dataset.relationCell ?? '' });
            else setHover(null);
        };
        const leave = () => setHover(null);
        host.addEventListener('pointerover', over);
        host.addEventListener('pointerleave', leave);
        return () => {
            host.removeEventListener('pointerover', over);
            host.removeEventListener('pointerleave', leave);
        };
    }, [setHover]);
    const spotlight = useMemo(() => relationSpotlight(hover, layout.edges, located, locatedCells), [hover, layout.edges, located, locatedCells]);
    // 聚焦时给宿主与亮着的字、标记打标记，其余的由样式退后（agent-results.css 的 data-relation-spotlight）。
    useLayoutEffect(() => {
        const host = rootRef.current?.parentElement;
        if (!host || !spotlight) return;
        const { cells, tags } = spotlight;
        const lit = [
            ...[...host.querySelectorAll<HTMLElement>('[data-relation-cell]')].filter(node => cells.has(node.dataset.relationCell ?? '')),
            ...[...host.querySelectorAll<HTMLElement>('[data-relation-spot]')].filter(node => (node.dataset.relationSpot ?? '').split(' ').some(key => tags.has(key))),
            ...(hover?.node ? [hover.node] : []),
        ];
        host.setAttribute('data-relation-spotlight', '');
        lit.forEach(node => node.setAttribute('data-relation-lit', ''));
        return () => {
            host.removeAttribute('data-relation-spotlight');
            lit.forEach(node => node.removeAttribute('data-relation-lit'));
        };
    }, [hover, spotlight]);
    // 线脚按方向与层次排开（见 relationLegSlots），嵌套的括线互不穿过。
    const offsets = new Map([...relationLegSlots(layout.edges, cell => measured?.boxes.get(cell.column + ':' + cell.part)?.cx)].map(([key, slot]) => [key, slot * LEG_GAP]));
    const drawn = measured ? placeBadges(layout.edges.flatMap(edge => {
        const shape = geometry(edge, measured.boxes, offsets);
        return shape ? [{ edge, ...shape, mark: edge.mark }] : [];
    })) : [];
    const isLit = (edge: RelationEdge) => spotlight?.edges.has(edge.id) ?? false;
    const tones = [...new Set(layout.edges.filter(edge => edge.directed).map(edge => edge.tone))];
    return <div ref={rootRef} className="pointer-events-none absolute inset-0 z-[5]" data-relation-overlay="" data-spotlight={spotlight ? '' : undefined}>
        {measured && <svg className="absolute left-0 top-0 overflow-visible" width={measured.width} height={measured.height} aria-hidden="true">
            <defs>{tones.map(tone => <marker key={tone} id={`${uid}-${tone}`} viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" fill={TONE_COLOR[tone]} />
            </marker>)}</defs>
            {drawn.map(({ edge, path }) => {
                const lit = isLit(edge);
                return <path key={edge.id} d={path} data-relation-edge={edge.id} data-relation-mark={edge.mark} data-relation-shape={edge.shape} data-tone={edge.tone}
                    data-located={located.has(edge.id) || undefined} data-lit={lit || undefined}
                    fill="none" stroke={TONE_COLOR[edge.tone]} strokeLinecap="round" strokeLinejoin="round"
                    strokeWidth={(edge.tone === 'clash' || edge.tone === 'control' ? 1.6 : 1.25) + (lit ? 1 : 0)}
                    strokeDasharray={TONE_DASH[edge.tone]}
                    opacity={spotlight ? (lit ? 1 : 0.12) : 0.45}
                    className="transition-opacity"
                    markerEnd={edge.directed ? `url(#${uid}-${edge.tone})` : undefined} />;
            })}
            {/* 加宽的透明线只负责悬停与点击：线太细，直接悬停很难命中。 */}
            {drawn.map(({ edge, path }) => <path key={'hit-' + edge.id} d={path} fill="none" stroke="transparent" strokeWidth={10} strokeLinecap="round"
                style={{ pointerEvents: 'stroke' }} onMouseEnter={() => setHover({ kind: 'edge', id: edge.id })} onMouseLeave={() => setHover(null)}
                onClick={onSelect ? () => onSelect(edge) : undefined} />)}
        </svg>}
        {drawn.map(({ edge, badge }) => {
            const lit = isLit(edge);
            const color = TONE_COLOR[edge.tone];
            const props = {
                'data-relation-badge': edge.id, 'data-tone': edge.tone, 'data-lit': lit || undefined, title: edge.description,
                className: `pointer-events-auto absolute ${badge.align === 'right' ? '-translate-x-full' : '-translate-x-1/2'} -translate-y-1/2 whitespace-nowrap rounded-[4px] border px-1 text-[0.625rem] font-medium leading-[0.8125rem] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1`,
                style: { left: badge.x, top: badge.y, color, borderColor: color, background: 'var(--background)', opacity: spotlight && !lit ? 0.3 : 1, outlineColor: color },
                onMouseEnter: () => setHover({ kind: 'edge', id: edge.id }), onMouseLeave: () => setHover(null),
            };
            // 能追问时是按钮；只读的柱位条里是带说明的标记，悬停仍会突出这条线。
            return onSelect
                ? <button key={edge.id} type="button" {...props} data-chart-target={edge.id.startsWith('bazi-relation-') ? edge.id : undefined}
                    aria-pressed={located.has(edge.id)} aria-label={`${edge.type}：${edge.description}`}
                    onFocus={() => setHover({ kind: 'edge', id: edge.id })} onBlur={() => setHover(null)} onClick={() => onSelect(edge)}>{edge.mark}</button>
                : <span key={edge.id} {...props} role="img" aria-label={`${edge.type}：${edge.description}`}>{edge.mark}</span>;
        })}
    </div>;
}
