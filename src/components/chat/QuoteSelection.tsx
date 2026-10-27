/**
 * 选中助手回答中的文字后，在选区上方浮出「引用」按钮。
 *
 * 手机长按选择同样触发 selectionchange；按钮用 portal 挂到 body 上，固定定位，不受消息列表滚动的
 * transform / contain 影响。只接受完全落在同一条助手消息里的选区。
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Quote } from 'lucide-react';
import type { ChatMessage } from '@/types';
import type { MessageQuote } from '@/lib/chat/quotes';

type QuoteTarget = { messageId: string; text: string; left: number; top: number; below: boolean };

const hostElement = (node: Node | null): Element | null => node instanceof Element ? node : node?.parentElement ?? null;

export function QuoteSelection({ containerRef, messages, onQuote, disabled = false }: {
    containerRef: React.RefObject<HTMLDivElement | null>;
    messages: readonly ChatMessage[];
    onQuote: (quote: MessageQuote) => void;
    /** While a reply streams or the transcript is locked, a selection would quote a moving target. */
    disabled?: boolean;
}) {
    const [target, setTarget] = useState<QuoteTarget | null>(null);
    const roles = useRef(new Map<string, ChatMessage['role']>());
    useEffect(() => { roles.current = new Map(messages.map(message => [message.id, message.role])); }, [messages]);

    const hide = useCallback(() => setTarget(current => current ? null : current), []);
    const update = useCallback(() => {
        if (disabled) { hide(); return; }
        const selection = typeof window === 'undefined' ? null : window.getSelection();
        const container = containerRef.current;
        if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !container) { hide(); return; }
        const start = hostElement(selection.anchorNode)?.closest('[data-message-id]');
        const end = hostElement(selection.focusNode)?.closest('[data-message-id]');
        const messageId = start?.getAttribute('data-message-id');
        if (!messageId || start !== end || roles.current.get(messageId) !== 'assistant') { hide(); return; }
        const range = selection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) { hide(); return; }
        const text = selection.toString().trim();
        if (text.length < 2) { hide(); return; }
        const rect = range.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) { hide(); return; }
        const below = rect.top < 64;
        const left = Math.min(Math.max(rect.left + rect.width / 2, 56), window.innerWidth - 56);
        const top = below ? rect.bottom + 10 : rect.top - 10;
        setTarget(current => current && current.messageId === messageId && current.text === text
            && current.left === left && current.top === top && current.below === below
            ? current : { messageId, text, left, top, below });
    }, [containerRef, disabled, hide]);

    useEffect(() => {
        document.addEventListener('selectionchange', update);
        document.addEventListener('pointerup', update);
        document.addEventListener('touchend', update, { passive: true });
        document.addEventListener('keyup', update);
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
        return () => {
            document.removeEventListener('selectionchange', update);
            document.removeEventListener('pointerup', update);
            document.removeEventListener('touchend', update);
            document.removeEventListener('keyup', update);
            window.removeEventListener('scroll', hide, true);
            window.removeEventListener('resize', hide);
        };
    }, [hide, update]);

    if (!target) return null;
    const accept = () => {
        onQuote({ messageId: target.messageId, text: target.text });
        window.getSelection()?.removeAllRanges();
        setTarget(null);
    };
    return createPortal(
        <button type="button" className={`chat-quote-select${target.below ? ' is-below' : ''}`}
            style={{ left: target.left, top: target.top }} aria-label="引用所选文字"
            onMouseDown={event => event.preventDefault()}
            onTouchStart={event => event.preventDefault()}
            onClick={accept}>
            <Quote size={13} aria-hidden="true" />引用
        </button>,
        document.body,
    );
}
