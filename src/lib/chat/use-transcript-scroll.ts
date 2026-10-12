'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ChatMessage } from '@/types';
import { isNearBottom } from './chat-scroll';
import { registerTranscript } from './message-navigation';

// App Router remounts the page on conversation query changes. Keep reading state
// for this browser tab outside the page, with account-scoped conversation keys.
const positions = new Map<string, { top: number; follow: boolean }>();

/** The ordinary and virtual transcripts use the same reading/follow rules. */
export function useTranscriptScroll({ scrollRef, followRef, conversationKey, messages, enabled, virtualized, reveal }: {
    scrollRef: MutableRefObject<HTMLDivElement | null>;
    followRef: MutableRefObject<boolean>;
    conversationKey: string;
    messages: ChatMessage[];
    enabled: boolean;
    virtualized: boolean;
    /** Puts a message hidden by the list (a folded round) back on the page before it is located. */
    reveal?: (id: string) => void;
}) {
    const frameRef = useRef(0);
    const restoreFrameRef = useRef(0);
    const messagesRef = useRef(messages);
    const revealRef = useRef(reveal);
    useLayoutEffect(() => { messagesRef.current = messages; revealRef.current = reveal; }, [messages, reveal]);
    const [showJump, setShowJump] = useState(false);
    const jumpToLatest = useCallback(() => {
        const element = scrollRef.current;
        if (!element) return;
        cancelAnimationFrame(restoreFrameRef.current);
        cancelAnimationFrame(frameRef.current);
        followRef.current = true;
        element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
        positions.set(conversationKey, { top: element.scrollTop, follow: true });
        setShowJump(false);
    }, [scrollRef, followRef, conversationKey]);
    const follow = useCallback(() => {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => {
            const element = scrollRef.current;
            if (!element) return;
            if (followRef.current) element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
            setShowJump(!followRef.current && !isNearBottom(element));
        });
    }, [scrollRef, followRef]);

    useEffect(() => {
        if (!enabled) return;
        const element = scrollRef.current;
        if (!element) return;
        const cache = positions;
        const saved = cache.get(conversationKey);
        const remember = () => {
            if (element.isConnected) cache.set(conversationKey, { top: element.scrollTop, follow: followRef.current });
        };
        followRef.current = saved?.follow ?? true;
        // Live resize/message updates can schedule following before this first placement.
        restoreFrameRef.current = requestAnimationFrame(() => {
            if (saved && !saved.follow) element.scrollTop = saved.top;
            else element.scrollTop = element.scrollHeight;
            setShowJump(!followRef.current && !isNearBottom(element));
            remember();
        });
        const onScroll = () => {
            if (!element.isConnected) return;
            followRef.current = isNearBottom(element);
            setShowJump(!followRef.current);
            remember();
        };
        const release = () => { followRef.current = false; cancelAnimationFrame(restoreFrameRef.current); cancelAnimationFrame(frameRef.current); remember(); };
        const unregister = registerTranscript(conversationKey, { release, locate: id => {
            revealRef.current?.(id);
            const message = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(row => row.dataset.messageId === id);
            if (virtualized) { element.dispatchEvent(new CustomEvent('taibu:locate-message', { detail: id })); return messagesRef.current.some(row => row.id === id); }
            message?.scrollIntoView({ block: 'start', behavior: 'auto' });
            setShowJump(true);
            return Boolean(message);
        } });
        const wheel = (event: WheelEvent) => { if (event.deltaY < 0) release(); };
        const keyboard = (event: KeyboardEvent) => { if (['PageUp', 'Home', 'ArrowUp'].includes(event.key) && !(event.target instanceof HTMLTextAreaElement)) release(); };
        const disclosure = (event: MouseEvent) => {
            if (event.target instanceof Element && event.target.closest('summary, button[aria-expanded]')) release();
        };
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
        observer?.observe(element);
        if (element.firstElementChild) observer?.observe(element.firstElementChild);
        element.addEventListener('scroll', onScroll);
        element.addEventListener('wheel', wheel, { passive: true });
        element.addEventListener('keydown', keyboard);
        element.addEventListener('click', disclosure, true);
        // Remember while attached: after a conversation change the old DOM has no scroll metrics.
        return () => {
            cancelAnimationFrame(restoreFrameRef.current);
            cancelAnimationFrame(frameRef.current);
            observer?.disconnect();
            unregister();
            element.removeEventListener('scroll', onScroll);
            element.removeEventListener('wheel', wheel);
            element.removeEventListener('keydown', keyboard);
            element.removeEventListener('click', disclosure, true);
        };
    }, [conversationKey, enabled, virtualized, scrollRef, followRef, follow]);

    // Includes Agent part updates, not only content/reasoning string lengths.
    useEffect(() => { if (enabled) follow(); }, [messages, enabled, follow]);
    return { showJump, jumpToLatest };
}
