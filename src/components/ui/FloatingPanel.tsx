'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './overlays.css';

// Only the foremost surface handles Escape when a picker opens inside a dialog.
const openPanels: HTMLElement[] = [];
/** Matching elements that are laid out: an item hidden at this width is skipped by focus and arrow keys. */
const rendered = (panel: HTMLElement, selector: string) => [...panel.querySelectorAll<HTMLElement>(selector)].filter(element => element.getClientRects().length > 0);

/**
 * claude 菜单的字母键：菜单项内 <kbd> 标注的单个字母，在菜单打开时按下即触发该项。
 * 只认无修饰键的单字符，输入框里打字不受影响。
 */
export function findMenuShortcut(panel: Pick<ParentNode, 'querySelectorAll'>, event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): HTMLElement | null {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return null;
    const letter = event.key.toUpperCase();
    return [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')]
        .find(item => item.querySelector('kbd')?.textContent?.trim().toUpperCase() === letter) ?? null;
}

/** Shared viewport-aware surface for model, tool, context and conversation menus. */
/** 子菜单与父菜单之间的水平间距（claude 子菜单紧贴父菜单）。 */
export const SUBMENU_GAP = 2;

/**
 * 子菜单的位置：优先贴在父菜单右缘外 SUBMENU_GAP，放不下时翻到左侧；
 * right-start 让子菜单第一项与父项同一水平线（减去面板上内边距），right 则底边对齐。
 */
export function placeSubmenu({ anchor, host, panel, side, viewport }: {
    anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
    host?: Pick<DOMRect, 'left' | 'right'> | null;
    panel: { width: number; height: number; paddingTop: number; paddingBottom: number };
    side: 'right' | 'right-start';
    viewport: { x: number; y: number; width: number; height: number; margin: number };
}): { left: number; top: number } {
    const { x, y, width, height, margin } = viewport;
    const right = Math.max(anchor.right, host?.right ?? 0) + SUBMENU_GAP;
    const leftSide = (host?.left ?? anchor.left) - panel.width - SUBMENU_GAP;
    const left = right + panel.width <= x + width - margin ? right : Math.max(x + margin, leftSide);
    const preferredTop = side === 'right-start' ? anchor.top - panel.paddingTop : anchor.bottom - panel.height + panel.paddingBottom;
    const maxTop = Math.max(y + margin, y + height - panel.height - margin);
    return { left, top: Math.max(y + margin, Math.min(preferredTop, maxTop)) };
}

export function FloatingPanel({ open, anchorRef, onClose, children, label, id, className = '',
    role = 'menu', side = 'bottom', align = 'start', initialFocus = 'first', restoreFocus = true, portaled = true, arrowNavigation = false,
}: {
    open: boolean;
    anchorRef: RefObject<HTMLElement | null>;
    onClose: () => void;
    children: ReactNode;
    label: string;
    id?: string;
    className?: string;
    role?: 'menu' | 'dialog';
    /** `right` opens beside the anchor, bottom-aligned; `right-start` top-aligns it for submenus. */
    side?: 'top' | 'bottom' | 'right' | 'right-start';
    align?: 'start' | 'end';
    initialFocus?: 'first' | 'none';
    /** Return focus after selecting an item; keyboard dismissal always returns it. */
    restoreFocus?: boolean;
    /** Keep a picker inside a native dialog's top-layer subtree. */
    portaled?: boolean;
    /** A dialog whose items are buttons can opt into the menu arrow/Home/End loop. */
    arrowNavigation?: boolean;
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const anchor = anchorRef.current;
        const panel = panelRef.current;
        if (!anchor || !panel) return;
        openPanels.push(panel);
        let frame = 0;
        let focused = false;
        const close = (returnFocus: boolean) => {
            if (returnFocus && anchor.isConnected) anchor.focus();
            closeRef.current();
        };
        const place = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const rect = anchor.getBoundingClientRect();
                const viewport = window.visualViewport;
                const width = viewport?.width ?? window.innerWidth;
                const height = viewport?.height ?? window.innerHeight;
                const x = viewport?.offsetLeft ?? 0;
                const y = viewport?.offsetTop ?? 0;
                if (!anchor.isConnected || rect.bottom <= y || rect.top >= y + height) { close(false); return; }
                const margin = 8;
                const maxLeft = Math.max(x + margin, x + width - panel.offsetWidth - margin);
                const maxTop = Math.max(y + margin, y + height - panel.offsetHeight - margin);
                let left: number;
                let top: number;
                if (side === 'right' || side === 'right-start') {
                    // 子菜单优先在行右侧；锚点在一级菜单里时以该菜单右缘为准。
                    const style = getComputedStyle(panel);
                    ({ left, top } = placeSubmenu({
                        anchor: rect, host: anchor.closest('.floating-panel')?.getBoundingClientRect(), side,
                        panel: { width: panel.offsetWidth, height: panel.offsetHeight, paddingTop: parseFloat(style.paddingTop) || 0, paddingBottom: parseFloat(style.paddingBottom) || 0 },
                        viewport: { x, y, width, height, margin },
                    }));
                } else {
                    left = Math.max(x + margin, Math.min(align === 'end' ? rect.right - panel.offsetWidth : rect.left, maxLeft));
                    const above = rect.top - panel.offsetHeight - 6;
                    const below = rect.bottom + 6;
                    const preferred = side === 'top' ? above : below;
                    const alternate = side === 'top' ? below : above;
                    const fits = (value: number) => value >= y + margin && value <= maxTop;
                    top = fits(preferred) ? preferred : fits(alternate) ? alternate : Math.max(y + margin, Math.min(preferred, maxTop));
                }
                setPosition(previous => previous?.left === left && previous.top === top ? previous : { left, top });
                // Write the spot before showing: the state commit can land after the next
                // paint, and revealing the panel at the stale spot reads as a flash.
                panel.style.left = `${left}px`;
                panel.style.top = `${top}px`;
                // Remove hidden before focusing; the first placement runs before paint.
                panel.style.visibility = 'visible';
                if (!focused && initialFocus !== 'none') {
                    focused = true;
                    // Focus that reached the panel before this frame (a tap or a script) stays where it is.
                    if (!panel.contains(document.activeElement)) {
                        const selected = rendered(panel, '[aria-checked="true"]:not(:disabled)')[0];
                        (selected ?? rendered(panel, 'input:not(:disabled), button:not(:disabled), [tabindex="0"]')[0])?.focus();
                    }
                }
            });
        };
        const outside = (event: PointerEvent) => {
            if (openPanels.at(-1) !== panel) return;
            if (event.target instanceof Node && !panel.contains(event.target) && !anchor.contains(event.target)) close(false);
        };
        const keyboard = (event: KeyboardEvent) => {
            if (openPanels.at(-1) !== panel) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
            if (role !== 'menu' && !arrowNavigation) return;
            if (!panel.contains(document.activeElement)) return;
            if (role !== 'menu' && !(document.activeElement instanceof HTMLButtonElement)) return;
            if (role === 'menu' && !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) {
                const shortcut = findMenuShortcut(panel, event);
                if (shortcut) { event.preventDefault(); shortcut.click(); return; }
            }
            if (event.key === 'Tab') { close(true); return; }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const items = rendered(panel, 'button:not(:disabled)');
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
        };
        const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.contains(event.target)) place(); };
        const observer = new ResizeObserver(place);
        observer.observe(panel);
        observer.observe(anchor);
        document.addEventListener('pointerdown', outside);
        window.addEventListener('keydown', keyboard, true);
        window.addEventListener('scroll', scroll, true);
        window.addEventListener('resize', place);
        window.visualViewport?.addEventListener('resize', place);
        window.visualViewport?.addEventListener('scroll', place);
        place();
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            const index = openPanels.indexOf(panel);
            if (index >= 0) openPanels.splice(index, 1);
            document.removeEventListener('pointerdown', outside);
            window.removeEventListener('keydown', keyboard, true);
            window.removeEventListener('scroll', scroll, true);
            window.removeEventListener('resize', place);
            window.visualViewport?.removeEventListener('resize', place);
            window.visualViewport?.removeEventListener('scroll', place);
        };
    }, [open, anchorRef, align, side, role, initialFocus, arrowNavigation]);

    if (!open || typeof document === 'undefined') return null;
    const panel = <div ref={panelRef} id={id} role={role} aria-label={label}
        className={`floating-panel ${className}`} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
        onClick={event => {
            if (role === 'menu' && restoreFocus && (event.target as HTMLElement).closest('button:not(:disabled)')) anchorRef.current?.focus();
        }}>{children}</div>;
    // A panel inside a native dialog must remain in that dialog's top-layer subtree.
    return portaled ? createPortal(panel, document.body) : panel;
}
