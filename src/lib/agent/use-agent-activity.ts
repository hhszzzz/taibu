'use client';
// Needs browser timers, visibility events and state for the sidebar's task markers.
import { useEffect, useMemo, useState } from 'react';
import { requestBrowserJson } from '@/lib/browser-api';
import { markSelectedAsRead } from '@/lib/notification';
import { getAgentActivityPollDelay, getConversationAgentMarkers, getConversationNoticeIds, parseAgentActivity, type AgentActivity, type ConversationAgentMarker } from './activity';

const AGENT_ACTIVITY_EVENT = 'taibu:agent-activity';

/** Asks every mounted task list to re-read its markers now (a task started, waits or ended). */
export function refreshAgentActivity() {
    window.dispatchEvent(new Event(AGENT_ACTIVITY_EVENT));
}

/**
 * Task markers for the conversation lists. Reads only while the list is shown
 * in a visible tab: every 10 seconds while a task is live, otherwise every
 * minute, and at once when the tab returns or a task changes on this page.
 * Opening a conversation reads its unread task notices.
 */
export function useAgentActivity(userId: string | null, viewingConversationId: string | null, enabled = true): ReadonlyMap<string, ConversationAgentMarker> {
    const [state, setState] = useState<{ userId: string; activity: AgentActivity } | null>(null);
    useEffect(() => {
        if (!userId || !enabled) return;
        const controller = new AbortController();
        let timer: number | undefined;
        let busy = false, again = false;
        const load = async () => {
            window.clearTimeout(timer);
            if (controller.signal.aborted || document.visibilityState !== 'visible') return;
            if (busy) { again = true; return; }
            busy = true;
            let activity: AgentActivity | null = null;
            try {
                const response = await requestBrowserJson<unknown>('/api/agent/activity', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
                activity = parseAgentActivity(response.data);
            } catch { /* Keeps the last markers and retries on the slow cadence. */ }
            busy = false;
            if (controller.signal.aborted) return;
            if (activity) setState({ userId, activity });
            if (again) { again = false; void load(); return; }
            timer = window.setTimeout(() => void load(), getAgentActivityPollDelay(activity));
        };
        const wake = () => { void load(); };
        void load();
        document.addEventListener('visibilitychange', wake);
        window.addEventListener('focus', wake);
        window.addEventListener(AGENT_ACTIVITY_EVENT, wake);
        return () => {
            controller.abort();
            window.clearTimeout(timer);
            document.removeEventListener('visibilitychange', wake);
            window.removeEventListener('focus', wake);
            window.removeEventListener(AGENT_ACTIVITY_EVENT, wake);
        };
    }, [userId, enabled]);

    const activity = state && state.userId === userId ? state.activity : null;
    const noticeKey = getConversationNoticeIds(enabled ? activity : null, viewingConversationId).join(',');
    useEffect(() => {
        if (!noticeKey || !userId || document.visibilityState !== 'visible') return;
        const ids = noticeKey.split(',');
        let current = true;
        void markSelectedAsRead(ids).then(read => {
            if (!read || !current) return;
            setState(previous => previous && previous.userId === userId
                ? { userId, activity: { ...previous.activity, notices: previous.activity.notices.filter(notice => !ids.includes(notice.id)) } }
                : previous);
        });
        return () => { current = false; };
    }, [noticeKey, userId]);

    return useMemo(() => getConversationAgentMarkers(enabled ? activity : null, viewingConversationId), [activity, enabled, viewingConversationId]);
}
