'use client';
// 需要测量字形位置（ResizeObserver）并保存悬停状态，才能把干支关系画在表上

import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { relationLegSlots, type RelationEdge, type RelationLayout, type RelationMode, type RelationTone } from '@/lib/divination/ganzhi-relation-layout';
import { elementTextClass, isFiveElement } from '@/components/bazi/element-classes';

/** 每层连线的高度（px）；表格按层数给天干行上方、地支行下方留白。 */
export const RELATION_LANE = 16;
const GLYPH_GAP = 3;

export function relationBandHeight(lanes: number) {
    return lanes > 0 ? lanes * RELATION_LANE + GLYPH_GAP : 0;
}

/** 干支之间的空档：要放下一支完整的竖箭头，左侧是生克徽标、右侧是根 / 透标记，所以固定比连线层高。 */
const CROSS_BAND = 30;
export function relationCrossHeight(lanes: number) {
    return lanes > 0 ? CROSS_BAND : 0;
}

const TONE_COLOR: Record<RelationTone, string> = {
    combine: 'var(--success)', meet: 'var(--success)', generate: 'var(--success)',
    clash: 'var(--danger)', control: 'var(--danger)',
    punish: 'var(--warning)', harm: 'var(--accent-strong)', break: 'var(--foreground-secondary)',
    same: 'var(--foreground-tertiary)', root: 'var(--accent)', reveal: 'var(--warning)',
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

type Geometry = { path: string; badge: { x: number; y: number } };

/** 一条关系的线与徽标位置；字形缺失（如时辰未知）时不画。 */
function geometry(edge: RelationEdge, boxes: Map<string, Box>, offsets: Map<string, number>): Geometry | null {
    const at = (cell: RelationEdge['cells'][number]) => boxes.get(cell.column + ':' + cell.part);
    const lineY = (box: Box, part: '天干' | '地支') => part === '天干'
        ? box.top - GLYPH_GAP - edge.lane * RELATION_LANE - RELATION_LANE / 2
        : box.bottom + GLYPH_GAP + edge.lane * RELATION_LANE + RELATION_LANE / 2;
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
        // 起点离字 2px；终点留 8px 给箭头，箭头本身不压到字形。
        const exitY = (index: number, target: boolean) => {
            const gap = target ? 8 : 2;
            return edge.cells[index].part === '天干' ? placed[index].bottom + gap : placed[index].top - gap;
        };
        const x0 = placed[0].cx + offset(0), x1 = placed[1].cx + offset(1);
        const y0 = exitY(0, false), y1 = exitY(1, true);
        if (edge.shape === 'vertical') {
            // 同一柱的干支自坐：一支竖箭头在字形中线上，徽标放在箭头左侧，不压住箭身。
            return { path: `M${x0} ${y0} V${y1}`, badge: { x: x0 - 6, y: (gapTop + gapBottom) / 2 } };
        }
        const y = Math.min(gapTop + edge.lane * RELATION_LANE + RELATION_LANE / 2, Math.max(gapTop + 2, gapBottom - 2));
        return { path: `M${x0} ${y0} V${y} H${x1} V${y1}`, badge: { x: (x0 + x1) / 2, y } };
    }
    // 相邻两字之间直接连一条横线：从来源字的边缘到结果字的边缘，箭头停在结果字前，不压字。
    if (edge.shape === 'inline') {
        const [from, to] = placed;
        const rightward = to.cx > from.cx;
        const y = (from.cy + to.cy) / 2;
        const x0 = rightward ? from.right + 4 : from.left - 4;
        const x1 = rightward ? to.left - (edge.directed ? 6 : 4) : to.right + (edge.directed ? 6 : 4);
        return { path: `M${x0} ${y} H${x1}`, badge: { x: (x0 + x1) / 2, y } };
    }
    const part = edge.cells[0].part;
    const y = lineY(placed[0], part);
    // 起点离字 2px；终点留 8px 给箭头，箭头本身不会压到字形。
    const glyphStart = (box: Box) => part === '天干' ? box.top - 2 : box.bottom + 2;
    const glyphEnd = (box: Box) => part === '天干' ? box.top - 8 : box.bottom + 8;
    const xs = placed.map((_, index) => placed[index].cx + offset(index));
    // 有方向的线画成一笔，终点落在被生 / 被克的字上，箭头才指得对。
    const path = edge.directed && placed.length === 2
        ? `M${xs[0]} ${glyphStart(placed[0])} V${y} H${xs[1]} V${glyphEnd(placed[1])}`
        : [`M${Math.min(...xs)} ${y} H${Math.max(...xs)}`, ...placed.map((box, index) => `M${xs[index]} ${index === placed.length - 1 ? glyphEnd(box) : glyphStart(box)} V${y}`)].join(' ');
    return { path, badge: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y } };
}

/** 同一个字上相邻两条线脚的间距（px）。 */
const LEG_GAP = 7;

/**
 * 画在八字表（或详查柱位条）上的干支关系层：天干之间的线在天干行上方，地支之间的在地支行下方，
 * 同柱干支的生克画在字形右侧，通根 / 透干标在字旁。点徽标交给 onSelect（Agent 里是追问这条关系）。
 */
export function GanzhiRelationOverlay({ layout, located, onSelect, muted }: {
    layout: RelationLayout;
    located: ReadonlySet<string>;
    onSelect?: (edge: RelationEdge) => void;
    /** 关系与流通同时显示、而 Agent 正在看其中一种时，另一种整体淡一些。 */
    muted?: RelationMode;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const [measured, setMeasured] = useState<ReturnType<typeof measure> | null>(null);
    const [active, setActive] = useState<string | null>(null);
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
    // 线脚按方向与层次排开（见 relationLegSlots），嵌套的括线互不穿过。
    const offsets = new Map([...relationLegSlots(layout.edges, cell => measured?.boxes.get(cell.column + ':' + cell.part)?.cx)].map(([key, slot]) => [key, slot * LEG_GAP]));
    // 通根 / 透干不再逐条画引线，改为每柱一个聚合标记（见 markerGroups）。
    const drawn = measured ? layout.edges.flatMap(edge => {
        // 根 / 透只进每柱的聚合标记，不再画竖线，干支之间每柱最多一支自坐箭头。
        if (edge.shape === 'marker' || (edge.shape === 'vertical' && (edge.tone === 'root' || edge.tone === 'reveal'))) return [];
        const shape = geometry(edge, measured.boxes, offsets);
        return shape ? [{ edge, ...shape }] : [];
    }) : [];
    // 同一柱的通根 / 透干合成一个标记（如「透2·根」），放在干支之间的空档里；不再一叠徽标互相压住。
    // 同柱透干本来是一根短竖箭头，也并进这个标记，避免出现「透 根·透」并排两枚。
    const groupedFlow = (edge: RelationEdge) => edge.shape === 'marker' || (edge.shape === 'vertical' && (edge.tone === 'reveal' || edge.tone === 'root'));
    const markerGroups = measured ? [...layout.edges.reduce((groups, edge) => {
        if (!groupedFlow(edge)) return groups;
        const column = edge.shape === 'marker' ? edge.anchor!.column : edge.cells[0].column;
        groups.set(column, [...(groups.get(column) ?? []), edge]);
        return groups;
    }, new Map<string, RelationEdge[]>())].flatMap(([column, edges]) => {
        const stem = measured.boxes.get(column + ':天干');
        const branch = measured.boxes.get(column + ':地支');
        if (!stem && !branch) return [];
        const y = stem && branch ? (stem.bottom + branch.top) / 2 : stem ? stem.bottom + CROSS_BAND / 2 : branch!.top - CROSS_BAND / 2;
        const marks = new Map<string, { mark: string; count: number; tone: RelationEdge['tone'] }>();
        for (const edge of edges) {
            const item = marks.get(edge.mark);
            if (item) item.count += 1;
            else marks.set(edge.mark, { mark: edge.mark, count: 1, tone: edge.tone });
        }
        // 标记贴在自坐箭头右侧（左缘对齐），与左侧的生克徽标隔着箭身。
        return [{ key: 'group:' + column, edges, x: (stem ?? branch!).cx + 6, y, marks: [...marks.values()] }];
    }) : [];
    // 模型定位的另一种模式的关系：不画线，只在结果字旁收成一个标记（如「冲·害·刑」）。
    const asideGroups = measured ? [...(layout.aside ?? []).reduce((groups, edge) => {
        const anchor = edge.cells[edge.cells.length - 1];
        const key = anchor.column + ':' + anchor.part;
        groups.set(key, [...(groups.get(key) ?? []), edge]);
        return groups;
    }, new Map<string, RelationEdge[]>())].flatMap(([key, edges]) => {
        const box = measured.boxes.get(key);
        if (!box) return [];
        const part = edges[0].cells[edges[0].cells.length - 1].part;
        const band = part === '天干' ? 'stem' : 'branch';
        // 旁置标记占该带最后一层（visibleRelationEdges 已为它加了一层）。
        const lane = Math.max(0, layout.lanes[band] - 1);
        const y = part === '天干'
            ? box.top - GLYPH_GAP - lane * RELATION_LANE - RELATION_LANE / 2
            : box.bottom + GLYPH_GAP + lane * RELATION_LANE + RELATION_LANE / 2;
        return [{ key: 'aside:' + key, edges, x: box.cx, y, marks: [...new Set(edges.map(edge => edge.mark))] }];
    }) : [];
    const groupKey = (edge: RelationEdge) => edge.shape === 'marker' && edge.anchor ? 'group:' + edge.anchor.column
        : edge.shape === 'vertical' && (edge.tone === 'reveal' || edge.tone === 'root') ? 'group:' + edge.cells[0].column : null;
    const emphasised = (edge: RelationEdge) => located.has(edge.id) || active === edge.id || active === groupKey(edge);
    const tones = [...new Set(layout.edges.filter(edge => edge.directed).map(edge => edge.tone))];
    return <div ref={rootRef} className="pointer-events-none absolute inset-0 z-[5]" data-relation-overlay="">
        {measured && <svg className="absolute left-0 top-0 overflow-visible" width={measured.width} height={measured.height} aria-hidden="true">
            <defs>{tones.map(tone => <marker key={tone} id={`${uid}-${tone}`} viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" fill={TONE_COLOR[tone]} />
            </marker>)}</defs>
            {drawn.map(({ edge, path }) => {
                const isEmphasised = emphasised(edge);
                return <path key={edge.id} d={path} data-relation-edge={edge.id} data-relation-mark={edge.mark} data-relation-shape={edge.shape} data-tone={edge.tone} data-located={located.has(edge.id) || undefined}
                    fill="none" stroke={TONE_COLOR[edge.tone]} strokeLinecap="round" strokeLinejoin="round"
                    strokeWidth={(edge.tone === 'clash' || edge.tone === 'control' ? 1.6 : edge.tone === 'root' || edge.tone === 'reveal' ? 1.1 : 1.25) + (isEmphasised ? 1 : 0)}
                    strokeDasharray={edge.shape === 'marker' ? '1 2' : TONE_DASH[edge.tone]}
                    opacity={(active && !isEmphasised ? 0.2 : edge.tone === 'root' || edge.tone === 'reveal' ? 0.75 : 0.9) * (edge.mode === muted && !isEmphasised ? 0.4 : 1)}
                    markerEnd={edge.directed && edge.shape !== 'marker' ? `url(#${uid}-${edge.tone})` : undefined} />;
            })}
        </svg>}
        {drawn.map(({ edge, badge }) => {
            const isLocated = located.has(edge.id);
            const color = TONE_COLOR[edge.tone];
            // 根 / 透 的「本气、中气」放进悬停说明，徽标只留一个字，避免长标签在行间互相压住。
            const text = edge.mark;
            const props = {
                'data-relation-badge': edge.id, 'data-tone': edge.tone, title: edge.description,
                className: `pointer-events-auto absolute ${edge.shape === 'vertical' ? '-translate-x-full' : '-translate-x-1/2'} -translate-y-1/2 whitespace-nowrap rounded-[4px] border px-1 text-[0.625rem] font-medium leading-[0.8125rem] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1`,
                style: { left: badge.x, top: badge.y, color: isLocated ? 'var(--background)' : color, borderColor: color, background: isLocated ? color : 'var(--background)', opacity: (active && active !== edge.id && !isLocated ? 0.45 : 1) * (edge.mode === muted && !isLocated && active !== edge.id ? 0.5 : 1), outlineColor: color },
                onMouseEnter: () => setActive(edge.id), onMouseLeave: () => setActive(null),
            };
            // 能追问时是按钮；只读的柱位条里是带说明的标记，悬停仍会突出这条线。
            return onSelect
                ? <button key={edge.id} type="button" {...props} data-chart-target={edge.id.startsWith('bazi-relation-') ? edge.id : undefined}
                    aria-pressed={isLocated} aria-label={`${edge.type}：${edge.description}`}
                    onFocus={() => setActive(edge.id)} onBlur={() => setActive(null)} onClick={() => onSelect(edge)}>{text}</button>
                : <span key={edge.id} {...props} role="img" aria-label={`${edge.type}：${edge.description}`}>{text}</span>;
        })}
        {markerGroups.map(group => {
            const first = group.edges[0];
            const isLocated = group.edges.some(edge => located.has(edge.id));
            const label = group.marks.map(item => item.mark + (item.count > 1 ? item.count : '')).join('·');
            const props = {
                'data-relation-badge': first.id, 'data-relation-marker-group': group.edges.length, 'data-relation-marks': group.marks.map(item => item.mark).join(','), 'data-relation-mark-counts': group.marks.map(item => item.mark + ':' + item.count).join(','), 'data-tone': first.tone,
                title: group.edges.map(edge => edge.description).join('\n'),
                className: 'pointer-events-auto absolute -translate-y-1/2 whitespace-nowrap rounded-[4px] border border-border bg-background px-1 text-[0.625rem] font-medium leading-[0.8125rem] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
                style: { left: group.x, top: group.y, opacity: (active && active !== group.key && !isLocated ? 0.45 : 1) * (muted === 'flow' && !isLocated && active !== group.key ? 0.5 : 1), outlineColor: 'var(--accent)' },
                onMouseEnter: () => setActive(group.key), onMouseLeave: () => setActive(null),
            };
            const content = <>{group.marks.map((item, index) => <span key={item.mark} style={{ color: TONE_COLOR[item.tone] }}>
                {index > 0 && <span className="text-foreground-tertiary">·</span>}{item.mark}{item.count > 1 && <sup className="ml-px text-[0.5rem] tabular-nums">{item.count}</sup>}
            </span>)}</>;
            return onSelect
                ? <button key={group.key} type="button" {...props} aria-label={`${label}：${group.edges.map(edge => edge.description).join('；')}`}
                    onFocus={() => setActive(group.key)} onBlur={() => setActive(null)} onClick={() => onSelect(first)}>{content}</button>
                : <span key={group.key} {...props} role="img" aria-label={`${label}：${group.edges.map(edge => edge.description).join('；')}`}>{content}</span>;
        })}
        {asideGroups.map(group => {
            const first = group.edges[0];
            const isLocated = group.edges.some(edge => located.has(edge.id));
            const props = {
                'data-relation-badge': first.id, 'data-relation-aside': group.edges.length, 'data-relation-marks': group.marks.join(','), 'data-tone': first.tone,
                title: group.edges.map(edge => edge.description).join('\n'),
                className: 'pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[4px] border border-dashed px-1 text-[0.625rem] font-medium leading-[0.8125rem] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
                style: { left: group.x, top: group.y, borderColor: TONE_COLOR[first.tone], background: 'var(--background)', opacity: active && active !== group.key && !isLocated ? 0.45 : 1, outlineColor: TONE_COLOR[first.tone] },
                onMouseEnter: () => setActive(group.key), onMouseLeave: () => setActive(null),
            };
            const content = <>{group.marks.map((mark, index) => <span key={mark} style={{ color: TONE_COLOR[group.edges.find(edge => edge.mark === mark)!.tone] }}>
                {index > 0 && <span className="text-foreground-tertiary">·</span>}{mark}
            </span>)}</>;
            return onSelect
                ? <button key={group.key} type="button" {...props} aria-label={`定位的关系：${group.edges.map(edge => edge.description).join('；')}`}
                    onFocus={() => setActive(group.key)} onBlur={() => setActive(null)} onClick={() => onSelect(first)}>{content}</button>
                : <span key={group.key} {...props} role="img" aria-label={`定位的关系：${group.edges.map(edge => edge.description).join('；')}`}>{content}</span>;
        })}
    </div>;
}

const CYCLE = ['木', '火', '土', '金', '水'] as const;

/**
 * 五行相生环：木→火→土→金→水→木，按数值标出每个五行，缺失的五行画成空心，相生在缺失处断开。
 * 数据来自五行详查（加权合计），没有详查时由调用方按干支字形计数并在 caption 里说明口径。
 */
export function WuxingCycleStrip({ counts, caption, dayElement }: {
    counts: ReadonlyArray<{ 五行: string; 合计: number; 出现: boolean }>;
    caption: string;
    dayElement?: string;
}) {
    const byElement = new Map(counts.map(item => [item.五行, item]));
    const present = (element: string) => byElement.get(element)?.出现 ?? false;
    const format = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);
    return <figure className="flex flex-col gap-1.5" data-wuxing-cycle="">
        <ol className="flex items-center gap-1 overflow-x-auto" aria-label="五行相生">
            {[...CYCLE, CYCLE[0]].map((element, index) => {
                const item = byElement.get(element);
                const isRepeat = index === CYCLE.length;
                const linked = index > 0 && present(CYCLE[index - 1]) && present(element);
                return <li key={index} className="flex shrink-0 items-center gap-1" data-element={element} data-present={present(element) || undefined}>
                    {index > 0 && <span aria-label={linked ? '相生' : '中断'} data-cycle-link={linked ? 'on' : 'off'}
                        className={linked ? 'text-foreground-secondary' : 'text-foreground-tertiary opacity-50'}>{linked ? '→' : '⇢'}</span>}
                    <span className={`flex min-w-[2.75rem] flex-col items-center rounded-lg px-1.5 py-0.5 leading-tight ${present(element) ? 'border border-border bg-background' : 'border border-dashed border-border bg-transparent'} ${isRepeat ? 'opacity-50' : ''}`}>
                        <span className={`font-display text-base ${present(element) && isFiveElement(element) ? elementTextClass(element) : 'text-foreground-tertiary'}`}>
                            {element}{element === dayElement && !isRepeat && <sup className="ml-px text-[0.5625rem] text-accent">日主</sup>}
                        </span>
                        {!isRepeat && <span className="text-[0.6875rem] tabular-nums text-foreground-secondary">{item ? format(item.合计) : '0'}</span>}
                    </span>
                </li>;
            })}
        </ol>
        <figcaption className="text-[0.6875rem] text-foreground-tertiary">{caption}</figcaption>
    </figure>;
}
