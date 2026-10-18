'use client';
/**
 * 统一 Tooltip（浅色表面 + 发丝描边、radius 6、内距 3px 8px、13px/18px、
 * z-index 130、入场 `opacity/scale .12s cubic-bezier(.32,.72,0,1)`）。
 *
 * 'use client' 标记说明：
 * - 需要 hover/focus 状态、展示定时器与触发元素定位测量
 *
 * 结构：外层 `<span class="ui-tip">`（`display: contents`，不参与布局）承接事件，
 * 内部子元素完全保持原样；定位锚点取事件目标最近的交互元素。
 */

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** 悬停多久后出现（避免扫过即弹）。 */
const SHOW_DELAY_MS = 400;
/** 气泡与触发元素之间的间距。 */
const OFFSET_PX = 6;
/** 触屏没有悬停语义。 */
const HOVER_QUERY = '(hover: none)';
/** 定位锚点：事件目标最近的交互元素（图标可能嵌在 button 里）。 */
const ANCHOR_SELECTOR = 'button, a[href], [role="button"], input, select, textarea, [tabindex]';

function clearTimer(ref: { current: number | null }) {
    if (ref.current !== null) window.clearTimeout(ref.current);
    ref.current = null;
}

export function Tooltip({ label, children, side = 'top' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' }) {
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
    const timerRef = useRef<number | null>(null);
    const id = useId();

    // 卸载时清掉未触发的定时器。
    useEffect(() => () => clearTimer(timerRef), []);

    // 打开期间任何滚动/尺寸变化都会让固定定位失效，直接收起。
    useEffect(() => {
        if (!position) return;
        const dismiss = () => { clearTimer(timerRef); setPosition(null); };
        window.addEventListener('scroll', dismiss, true);
        window.addEventListener('resize', dismiss);
        return () => {
            window.removeEventListener('scroll', dismiss, true);
            window.removeEventListener('resize', dismiss);
        };
    }, [position]);

    const anchorOf = (target: EventTarget | null) => {
        const node = target instanceof Element ? target : null;
        return node?.closest<HTMLElement>(ANCHOR_SELECTOR) ?? node as HTMLElement | null;
    };

    /** 悬停与键盘聚焦走同一条路径（聚焦时也给出可见提示）。 */
    const startFrom = (target: EventTarget | null) => {
        if (window.matchMedia(HOVER_QUERY).matches) return;
        const anchor = anchorOf(target);
        if (!anchor) return;
        clearTimer(timerRef);
        timerRef.current = window.setTimeout(() => {
            const rect = anchor.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            setPosition({
                left: rect.left + rect.width / 2,
                top: side === 'top' ? rect.top - OFFSET_PX : rect.bottom + OFFSET_PX,
            });
        }, SHOW_DELAY_MS);
    };

    const handleEnter = (event: ReactMouseEvent<HTMLSpanElement>) => startFrom(event.target);
    const handleFocus = (event: FocusEvent<HTMLSpanElement>) => startFrom(event.target);

    const handleLeave = () => {
        clearTimer(timerRef);
        setPosition(null);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === 'Escape') handleLeave();
    };

    return (
        <>
            <span
                className="ui-tip"
                onMouseEnter={handleEnter}
                onMouseLeave={handleLeave}
                onFocus={handleFocus}
                onBlur={handleLeave}
                onKeyDown={handleKeyDown}
            >
                {children}
            </span>
            {position ? createPortal(
                <span
                    id={id}
                    role="tooltip"
                    className="ui-tip-bubble"
                    data-side={side}
                    style={{ left: `${position.left}px`, top: `${position.top}px` }}
                >
                    {label}
                </span>,
                document.body,
            ) : null}
        </>
    );
}
