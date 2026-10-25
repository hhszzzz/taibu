'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './overlays.css';

/**
 * Native top-layer modal: focus containment, backdrop, Escape and focus return.
 *
 * Closing plays the dialog's exit animation first (`[data-closing]` in globals.css and the variants' own sheets),
 * then leaves the top layer. Without a stylesheet or with reduced motion there is nothing to wait for and it closes
 * at once.
 */
export function Modal({ open, onClose, children, labelledBy, describedBy, className = '',
    busy = false, initialFocusRef, returnFocusRef, keepMounted = false, id,
}: {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    labelledBy: string;
    describedBy?: string;
    className?: string;
    busy?: boolean;
    initialFocusRef?: RefObject<HTMLElement | null>;
    returnFocusRef?: RefObject<HTMLElement | null>;
    keepMounted?: boolean;
    id?: string;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    // Still shown while the exit animation plays after `open` turned false.
    const [present, setPresent] = useState(open);
    if (open && !present) setPresent(true);
    useLayoutEffect(() => {
        const dialog = ref.current;
        if (open) { dialog?.removeAttribute('data-closing'); return; }
        if (!present) return;
        if (!dialog) { setPresent(false); return; }
        dialog.setAttribute('data-closing', '');
        // Only the dialog's own finite animations (and its ::backdrop's); a spinner inside never finishes.
        const animations = dialog.getAnimations({ subtree: true }).filter(animation => animation.effect instanceof KeyframeEffect
            && animation.effect.target === dialog && Number.isFinite(animation.effect.getComputedTiming().endTime));
        if (!animations.length) { setPresent(false); return; }
        let current = true;
        void Promise.allSettled(animations.map(animation => animation.finished)).then(() => { if (current) setPresent(false); });
        return () => { current = false; };
    }, [open, present]);
    useEffect(() => {
        const dialog = ref.current;
        if (!present || !dialog) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const returnFocus = returnFocusRef?.current;
        dialog.showModal();
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        initialFocusRef?.current?.focus();
        return () => {
            dialog.close();
            document.body.style.overflow = overflow;
            const target = returnFocus ?? previous;
            if (target?.isConnected) target.focus();
        };
    }, [present, initialFocusRef, returnFocusRef]);
    if ((!present && !keepMounted) || typeof document === 'undefined') return null;
    return createPortal(<dialog ref={ref} id={id} tabIndex={-1} aria-labelledby={labelledBy} aria-describedby={describedBy}
        aria-busy={busy || undefined} className={`app-modal ${className}`} inert={!open || undefined}
        onKeyDown={event => {
            if (event.key !== 'Tab' || event.defaultPrevented) return;
            const dialog = event.currentTarget;
            const focusable = [...dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex], summary, [contenteditable="true"]')]
                .filter(element => element.tabIndex >= 0 && !element.matches(':disabled')
                    && !element.closest('[inert]') && element.getClientRects().length > 0
                    && getComputedStyle(element).visibility !== 'hidden');
            const first = focusable[0];
            const last = focusable.at(-1);
            const active = document.activeElement;
            // Native dialogs can send boundary Tab presses into browser chrome.
            if (!first || !focusable.includes(active as HTMLElement)
                || (event.shiftKey ? active === first : active === last)) {
                event.preventDefault();
                (event.shiftKey ? last : first)?.focus();
                if (!first) dialog.focus();
            }
        }}
        onCancel={event => { event.preventDefault(); if (!busy && open) onClose(); }}
        onClick={event => {
            if (busy || !open || event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
        }}>{children}</dialog>, document.body);
}
