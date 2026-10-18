/**
 * 侧栏「最近使用」列表偏好（claude 分组和排序菜单）：分组依据 / 排序方式 / 显示。
 *
 * 纯前端 localStorage，按用户隔离；侧栏组头与列表共享同一份快照，
 * 通过自定义事件让同一页面的两个订阅点同步（storage 事件覆盖跨标签页）。
 *
 * 'use client' 标记说明：
 * - 依赖 useSyncExternalStore 与 localStorage
 */
'use client';

import { useSyncExternalStore } from 'react';

export const CONVERSATION_SORT_ORDER = ['recent', 'title'] as const;
export const CONVERSATION_DISPLAY = ['all', 'pinned', 'running'] as const;

export type ConversationSortOrder = typeof CONVERSATION_SORT_ORDER[number];
export type ConversationDisplay = typeof CONVERSATION_DISPLAY[number];

export interface ConversationListPreferences {
    sort: ConversationSortOrder;
    display: ConversationDisplay;
}

export const CONVERSATION_LIST_DEFAULTS: ConversationListPreferences = { sort: 'recent', display: 'all' };
export const CONVERSATION_SORT_LABELS: Record<ConversationSortOrder, string> = { recent: '最近活动', title: '标题' };
export const CONVERSATION_DISPLAY_LABELS: Record<ConversationDisplay, string> = { all: '全部', pinned: '已置顶', running: '进行中' };

const EVENT = 'taibu:conversation-list-prefs';
const storageKey = (userId: string) => `taibu:conversation-list-prefs:${userId}`;

function parse(value: unknown): ConversationListPreferences {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return CONVERSATION_LIST_DEFAULTS;
    const input = value as Record<string, unknown>;
    return {
        sort: CONVERSATION_SORT_ORDER.includes(input.sort as ConversationSortOrder) ? input.sort as ConversationSortOrder : 'recent',
        display: CONVERSATION_DISPLAY.includes(input.display as ConversationDisplay) ? input.display as ConversationDisplay : 'all',
    };
}

/** One stable snapshot per stored string: useSyncExternalStore requires reference equality. */
let snapshot: { key: string; value: ConversationListPreferences } = { key: '', value: CONVERSATION_LIST_DEFAULTS };

export function loadConversationListPreferences(userId: string | null): ConversationListPreferences {
    if (!userId || typeof window === 'undefined') return CONVERSATION_LIST_DEFAULTS;
    try {
        const stored = window.localStorage.getItem(storageKey(userId));
        // 兼容旧版「排序方式」偏好：首次升级时沿用用户此前选过的排序。
        const legacy = stored === null ? window.localStorage.getItem(`taibu:conversation-sort:${userId}`) : '';
        const key = `${userId}\u0000${stored ?? ''}\u0000${legacy}`;
        if (snapshot.key === key) return snapshot.value;
        const value = stored !== null ? parse(JSON.parse(stored))
            : legacy === 'title' ? { ...CONVERSATION_LIST_DEFAULTS, sort: 'title' as const } : CONVERSATION_LIST_DEFAULTS;
        snapshot = { key, value };
        return value;
    } catch {
        return CONVERSATION_LIST_DEFAULTS;
    }
}

export function saveConversationListPreferences(userId: string | null, next: ConversationListPreferences): void {
    if (!userId || typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
    } catch {
        /* 隐私模式下写不进去：本次会话仍然通过事件生效 */
    }
    window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
        window.removeEventListener(EVENT, onChange);
        window.removeEventListener('storage', onChange);
    };
}

const serverSnapshot = () => CONVERSATION_LIST_DEFAULTS;

/** 侧栏组头与列表共享的偏好快照。 */
export function useConversationListPreferences(userId: string | null): ConversationListPreferences {
    return useSyncExternalStore(subscribe, () => loadConversationListPreferences(userId), serverSnapshot);
}
