'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './overlays.css';

// Only the foremost surface handles Escape when a picker opens inside a dialog.
const openPanels: HTMLElement[] = [];
/** Matching elements that are laid out: an item hidden at this width is skipped by focus and arrow keys. */
const rendered = (panel: HTMLElement, selector: string) => [...panel.querySelectorAll<HTMLElement>(selector)].filter(element => element.getClientRects().length > 0);

/** Shared viewport-aware surface for model, tool, context and conversation menus. */
export function FloatingPanel({ open, anchorRef, onClose, children, label, id, className = '',
    role = 'menu', side = 'bottom', align = 'start', initialFocus = 'first', restoreFocus = true, portaled = true,
}: {
    open: boolean;
    anchorRef: RefObject<HTMLElement | null>;
    onClose: () => void;
    children: ReactNode;
    label: string;
    id?: string;
    className?: string;
    role?: 'menu' | 'dialog';
    side?: 'top' | 'bottom';
    align?: 'start' | 'end';
    initialFocus?: 'first' | 'none';
    /** Return focus after selecting an item; keyboard dismissal always returns it. */
    restoreFocus?: boolean;
    /** Keep a picker inside a native dialog's top-layer subtree. */
    portaled?: boolean;
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
                const left = Math.max(x + margin, Math.min(align === 'end' ? rect.right - panel.offsetWidth : rect.left, maxLeft));
                const above = rect.top - panel.offsetHeight - 6;
                const below = rect.bottom + 6;
                const maxTop = Math.max(y + margin, y + height - panel.offsetHeight - margin);
                const preferred = side === 'top' ? above : below;
                const alternate = side === 'top' ? below : above;
                const fits = (value: number) => value >= y + margin && value <= maxTop;
                const top = fits(preferred) ? preferred : fits(alternate) ? alternate : Math.max(y + margin, Math.min(preferred, maxTop));
                setPosition(previous => previous?.left === left && previous.top === top ? previous : { left, top });
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
            if (role !== 'menu' || !panel.contains(document.activeElement)) return;
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
    }, [open, anchorRef, align, side, role, initialFocus]);

    if (!open || typeof document === 'undefined') return null;
    const panel = <div ref={panelRef} id={id} role={role} aria-label={label}
        className={`floating-panel ${className}`} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
        onClick={event => {
            if (role === 'menu' && restoreFocus && (event.target as HTMLElement).closest('button:not(:disabled)')) anchorRef.current?.focus();
        }}>{children}</div>;
    // A panel inside a native dialog must remain in that dialog's top-layer subtree.
    return portaled ? createPortal(panel, document.body) : panel;
}
