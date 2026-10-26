'use client';

/**
 * 列表的增删与重排：离开的行先收起再移除，置顶、补位、新增时其余各行从原位置滑到新位置，新出现的行上浮淡入。
 *
 * 行用 `data-motion-key`（稳定的业务 id）标识，须是列表的直接子元素。位置取布局位置、相对列表本身计算：
 * 动画中的位移和页面滚动都不算移动；列表尺寸变化（窗口缩放、某行展开、离开的行收起）只更新记录、不播放，
 * 下次真正重排时才不会从过时的位置滑过来。列表刚出现（首次加载、加载占位之后）时只记录、不播放。
 * 时长与缓动对应 globals.css「动效体系」的 --duration-* / --ease-*。
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { MOTION_EASE_OUT, MOTION_EASE_SNAP, playEntrance, prefersReducedMotion } from './entrance';

export type ListMotionRow<T> = { key: string; item: T; leaving: boolean };

type Collapse = { finished: Promise<void>; restore: () => void };

const sliding = new WeakMap<HTMLElement, Animation>();

/**
 * 从布局位置 `before` 滑到当前布局位置 `after`（FLIP）。上一段滑动还没走完时，从它眼下的位置接着滑。
 */
export function slide(node: HTMLElement, before: number, after: number, duration = 240) {
    const running = sliding.get(node);
    const residual = running?.playState === 'running' ? parseFloat(getComputedStyle(node).translate.split(' ')[1] ?? '') || 0 : 0;
    running?.cancel();
    const delta = before + residual - after;
    if (Math.abs(delta) >= 1) sliding.set(node, node.animate([{ translate: `0 ${delta}px` }, { translate: '0 0' }], { duration, easing: MOTION_EASE_SNAP }));
}

const rowsOf = (list: HTMLElement) => list.querySelectorAll<HTMLElement>(':scope > [data-motion-key]');

/** 各行相对列表顶部的布局位置（offsetTop 不含 transform/translate）。 */
function measureRows(list: HTMLElement) {
    const positions = new Map<string, number>();
    for (const node of rowsOf(list)) positions.set(node.dataset.motionKey!, node.offsetParent === list ? node.offsetTop : node.offsetTop - list.offsetTop);
    return positions;
}

/**
 * 收起一行：淡出并收起高度，连同它在 flex/grid 里占的间距，下面的行随之平滑上移。收起期间不可交互、
 * 不进入无障碍树；`instant` 或减少动态效果时立即收起。
 */
function collapseOut(element: HTMLElement | null, instant: boolean): Collapse {
    if (!element) return { finished: Promise.resolve(), restore: () => {} };
    const parent = element.parentElement;
    const layout = parent ? getComputedStyle(parent) : null;
    const gap = layout && /flex|grid/u.test(layout.display) ? parseFloat(layout.rowGap) || 0 : 0;
    // 连同一侧的间距一起让出：后面有行时让出下方的间距，最后一行让出上方的。
    const spacing = !gap ? {} : element.nextElementSibling ? { marginBlockEnd: `${-gap}px` } : element.previousElementSibling ? { marginBlockStart: `${-gap}px` } : {};
    const { overflow } = element.style;
    const { inert } = element;
    const options: KeyframeAnimationOptions = { duration: instant || prefersReducedMotion() ? 0 : 200, easing: MOTION_EASE_OUT, fill: 'forwards' };
    // 首行（末行）离开后，邻行靠相邻规则得来的分隔线（`li + li` 的上边线、`:not(:last-child)` 的下边线）也会消失：
    // 这一行自己那一侧没有边线、邻行却有时，一起收掉，免得移除时跳一像素。
    const own = getComputedStyle(element);
    const [neighbor, side] = !element.previousElementSibling ? [element.nextElementSibling, 'borderTopWidth'] as const
        : !element.nextElementSibling ? [element.previousElementSibling, 'borderBottomWidth'] as const : [null, null];
    const divider = neighbor instanceof HTMLElement && side && !parseFloat(own[side]) && parseFloat(getComputedStyle(neighbor)[side])
        ? neighbor.animate([{ [side]: getComputedStyle(neighbor)[side] }, { [side]: '0px' }], options)
        : null;
    element.style.overflow = 'clip';
    element.inert = true;
    const animation = element.animate([
        { opacity: 1, height: `${element.getBoundingClientRect().height}px` },
        { opacity: 0, height: '0px', paddingBlock: '0px', borderBlockWidth: '0px', ...spacing },
    ], options);
    return {
        finished: animation.finished.then(() => undefined, () => undefined),
        restore: () => {
            animation.cancel();
            divider?.cancel();
            element.style.overflow = overflow;
            element.inert = inert;
        },
    };
}

/** 新数据与上次渲染的行合并：不在新数据里的行标为离开，留在它原来的前一行之后。 */
function mergeRows<T>(previous: readonly ListMotionRow<T>[], items: readonly T[], keyOf: (item: T) => string) {
    const rows: ListMotionRow<T>[] = items.map(item => ({ key: keyOf(item), item, leaving: false }));
    const present = new Set(rows.map(row => row.key));
    let cursor = 0;
    for (const row of previous) {
        if (present.has(row.key)) cursor = rows.findIndex(candidate => candidate.key === row.key) + 1;
        else rows.splice(cursor++, 0, row.leaving ? row : { ...row, leaving: true });
    }
    return rows;
}

const sameItems = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * 渲染列表时用返回的行代替 `items`：每行渲染成列表 `ref` 的直接子元素并带 `data-motion-key={row.key}`。
 * 从 `items` 里拿掉的条目仍以 `leaving` 留在原位，收起后才移除；收起途中它又回到 `items`（如删除失败）时恢复原样。
 * `items` 的元素需在渲染之间保持引用稳定（来自 state、query 或 useMemo）。
 */
export function useListMotion<T>(ref: RefObject<HTMLElement | null>, items: readonly T[], keyOf: (item: T) => string): readonly ListMotionRow<T>[] {
    const [state, setState] = useState(() => ({ items, rows: mergeRows<T>([], items, keyOf) }));
    let { rows } = state;
    if (!sameItems(state.items, items)) {
        rows = mergeRows(state.rows, items, keyOf);
        setState({ items, rows });
    }
    const layout = useRef<{ list: HTMLElement; positions: Map<string, number> } | null>(null);
    const collapsing = useRef(new Map<string, Collapse>());

    useLayoutEffect(() => {
        const list = ref.current;
        const previous = list && layout.current?.list === list ? layout.current.positions : null;
        const positions = list ? measureRows(list) : null;
        layout.current = list && positions ? { list, positions } : null;

        if (list && positions && previous && !prefersReducedMotion()) {
            for (const node of rowsOf(list)) {
                const key = node.dataset.motionKey!;
                const before = previous.get(key);
                if (before === undefined) {
                    playEntrance(node, 'fadeUp');
                    continue;
                }
                slide(node, before, positions.get(key)!);
            }
        }

        const leaving = new Set(rows.filter(row => row.leaving).map(row => row.key));
        // 不再离开的行：已移除的撤掉邻行分隔线的临时收起，回到列表的（如删除失败）恢复原样。
        for (const [key, collapse] of collapsing.current) {
            if (leaving.has(key)) continue;
            collapse.restore();
            collapsing.current.delete(key);
        }
        for (const key of leaving) {
            if (collapsing.current.has(key)) continue;
            // 列表刚出现时，离开的行来自加载之前，直接收起不播放。
            const collapse = collapseOut(list?.querySelector<HTMLElement>(`:scope > [data-motion-key="${CSS.escape(key)}"]`) ?? null, !previous);
            collapsing.current.set(key, collapse);
            void collapse.finished.then(() => {
                if (collapsing.current.get(key) === collapse) setState(current => ({ ...current, rows: current.rows.filter(row => !(row.leaving && row.key === key)) }));
            });
        }

        if (!list || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => {
            if (layout.current?.list === list) layout.current.positions = measureRows(list);
        });
        observer.observe(list);
        return () => observer.disconnect();
    }, [ref, rows]);

    return rows;
}
