'use client';
// 需要测量字形位置（ResizeObserver）并保存悬停状态，才能把干支关系画在表上

import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { RelationEdge, RelationLayout, RelationTone } from '@/lib/divination/ganzhi-relation-layout';
import { elementTextClass, isFiveElement } from '@/components/bazi/element-classes';

/** 每层连线的高度（px）；表格按层数给天干行上方、地支行下方留白。 */
export const RELATION_LANE = 16;
const GLYPH_GAP = 3;

export function relationBandHeight(lanes: number) {
    return lanes > 0 ? lanes * RELATION_LANE + GLYPH_GAP : 0;
}

const TONE_COLOR: Record<RelationTone, string> = {
    combine: 'var(--success)', meet: 'var(--success)', generate: 'var(--success)',
    clash: 'var(--danger)', control: 'var(--danger)',
    punish: 'var(--warning)', harm: 'var(--accent-strong)', break: 'var(--foreground-secondary)',
    same: 'var(--foreground-tertiary)', root: 'var(--accent)', reveal: 'var(--accent)',
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
    if (edge.shape === 'marker') {
        const box = edge.anchor && at(edge.anchor);
        if (!box || !edge.anchor) return null;
        const y = lineY(box, edge.anchor.part);
        const edgeY = edge.anchor.part === '天干' ? box.top : box.bottom;
        return { path: `M${box.cx} ${edgeY} V${y}`, badge: { x: box.cx, y } };
    }
    const cells = edge.cells.map(at);
    if (cells.some(box => !box)) return null;
    const placed = cells as Box[];
    if (edge.shape === 'vertical') {
        const x = Math.max(...placed.map(box => box.right)) + 6;
        const [from, to] = placed;
        const down = from.cy < to.cy;
        const y0 = down ? from.cy + 2 : from.cy - 2, y1 = down ? to.cy - 2 : to.cy + 2;
        return { path: `M${x} ${y0} V${y1}`, badge: { x: x + 1, y: (y0 + y1) / 2 } };
    }
    const part = edge.cells[0].part;
    const y = lineY(placed[0], part);
    const legX = (index: number) => placed[index].cx + (offsets.get(edge.id + '@' + index) ?? 0);
    const glyphY = (box: Box) => part === '天干' ? box.top + 1 : box.bottom - 1;
    const xs = placed.map((_, index) => legX(index));
    // 有方向的线画成一笔，终点落在被生 / 被克的字上，箭头才指得对。
    const path = edge.directed && placed.length === 2
        ? `M${xs[0]} ${glyphY(placed[0])} V${y} H${xs[1]} V${glyphY(placed[1])}`
        : [`M${Math.min(...xs)} ${y} H${Math.max(...xs)}`, ...placed.map((box, index) => `M${xs[index]} ${glyphY(box)} V${y}`)].join(' ');
    return { path, badge: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y } };
}

/** 同一个字上有几条线落脚时，左右错开几像素，避免竖线重叠成一根。 */
function legOffsets(edges: RelationEdge[]) {
    const byCell = new Map<string, Array<{ key: string; lane: number }>>();
    for (const edge of edges) {
        if (edge.shape !== 'arc') continue;
        edge.cells.forEach((cell, index) => {
            const key = cell.column + ':' + cell.part;
            byCell.set(key, [...(byCell.get(key) ?? []), { key: edge.id + '@' + index, lane: edge.lane }]);
        });
    }
    const offsets = new Map<string, number>();
    for (const legs of byCell.values()) {
        legs.sort((a, b) => a.lane - b.lane).forEach((leg, index) => offsets.set(leg.key, (index - (legs.length - 1) / 2) * 5));
    }
    return offsets;
}

/**
 * 画在八字表（或详查柱位条）上的干支关系层：天干之间的线在天干行上方，地支之间的在地支行下方，
 * 同柱干支的生克画在字形右侧，通根 / 透干标在字旁。点徽标交给 onSelect（Agent 里是追问这条关系）。
 */
export function GanzhiRelationOverlay({ layout, located, onSelect }: {
    layout: RelationLayout;
    located: ReadonlySet<string>;
    onSelect?: (edge: RelationEdge) => void;
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
    const offsets = legOffsets(layout.edges);
    const drawn = measured ? layout.edges.flatMap(edge => {
        const shape = geometry(edge, measured.boxes, offsets);
        return shape ? [{ edge, ...shape }] : [];
    }) : [];
    const tones = [...new Set(layout.edges.filter(edge => edge.directed).map(edge => edge.tone))];
    return <div ref={rootRef} className="pointer-events-none absolute inset-0 z-[5]" data-relation-overlay="">
        {measured && <svg className="absolute left-0 top-0 overflow-visible" width={measured.width} height={measured.height} aria-hidden="true">
            <defs>{tones.map(tone => <marker key={tone} id={`${uid}-${tone}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" fill={TONE_COLOR[tone]} />
            </marker>)}</defs>
            {drawn.map(({ edge, path }) => {
                const emphasised = located.has(edge.id) || active === edge.id;
                return <path key={edge.id} d={path} data-relation-edge={edge.id} data-tone={edge.tone} data-located={located.has(edge.id) || undefined}
                    fill="none" stroke={TONE_COLOR[edge.tone]} strokeLinecap="round" strokeLinejoin="round"
                    strokeWidth={(edge.tone === 'clash' || edge.tone === 'control' ? 1.75 : 1.25) + (emphasised ? 1 : 0)}
                    strokeDasharray={edge.shape === 'marker' ? '1 2' : TONE_DASH[edge.tone]}
                    opacity={active && !emphasised ? 0.3 : 0.9}
                    markerEnd={edge.directed && edge.shape !== 'marker' ? `url(#${uid}-${edge.tone})` : undefined} />;
            })}
        </svg>}
        {drawn.map(({ edge, badge }) => {
            const isLocated = located.has(edge.id);
            const color = TONE_COLOR[edge.tone];
            const text = edge.shape === 'marker' && edge.result ? `${edge.mark}·${edge.result.charAt(0)}` : edge.mark;
            const props = {
                'data-relation-badge': edge.id, 'data-tone': edge.tone, title: edge.description,
                className: 'pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[4px] border px-1 text-[0.625rem] font-medium leading-[0.8125rem] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
                style: { left: badge.x, top: badge.y, color: isLocated ? 'var(--background)' : color, borderColor: color, background: isLocated ? color : 'var(--background)', opacity: active && active !== edge.id && !isLocated ? 0.45 : 1, outlineColor: color },
                onMouseEnter: () => setActive(edge.id), onMouseLeave: () => setActive(null),
            };
            // 能追问时是按钮；只读的柱位条里是带说明的标记，悬停仍会突出这条线。
            return onSelect
                ? <button key={edge.id} type="button" {...props} data-chart-target={edge.id.startsWith('bazi-relation-') ? edge.id : undefined}
                    aria-pressed={isLocated} aria-label={`${edge.type}：${edge.description}`}
                    onFocus={() => setActive(edge.id)} onBlur={() => setActive(null)} onClick={() => onSelect(edge)}>{text}</button>
                : <span key={edge.id} {...props} role="img" aria-label={`${edge.type}：${edge.description}`}>{text}</span>;
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
