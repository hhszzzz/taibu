/**
 * 对话记录视图：普通 / 详细（claude 会话标题菜单的「对话记录视图」）。
 *
 * 普通：各轮的工具步骤折叠成一行摘要，点摘要展开；
 * 详细：工具步骤与参数/结果默认全部展开。
 * 视图按会话保存；「将 X 设为默认」把当前视图写成之后新会话的默认值。
 *
 * 纯前端 localStorage 偏好，按用户区分；跨标签页通过 storage 事件同步。
 *
 * 'use client' 标记说明：
 * - 依赖 useSyncExternalStore 与 localStorage
 */
'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';

export const CHAT_RECORD_VIEWS = ['normal', 'detailed'] as const;
export type ChatRecordView = typeof CHAT_RECORD_VIEWS[number];
export const CHAT_RECORD_VIEW_LABELS: Record<ChatRecordView, string> = { normal: '普通', detailed: '详细' };

const EVENT = 'taibu:chat-record-view';
const defaultKeyFor = (userId: string | null) => `taibu:chat-record-view:${userId ?? 'anonymous'}`;
const conversationKeyFor = (userId: string | null, conversationId: string) => `${defaultKeyFor(userId)}:${conversationId}`;

function parse(value: string | null): ChatRecordView | null {
    return value === 'detailed' || value === 'normal' ? value : null;
}

export function readChatRecordView(userId: string | null, conversationId: string | null = null): ChatRecordView {
    if (typeof window === 'undefined') return 'normal';
    try {
        const scoped = conversationId ? parse(window.localStorage.getItem(conversationKeyFor(userId, conversationId))) : null;
        return scoped ?? parse(window.localStorage.getItem(defaultKeyFor(userId))) ?? 'normal';
    } catch {
        return 'normal';
    }
}

/** 新会话使用的默认视图（没有会话级覆盖时）。 */
export function readChatRecordViewDefault(userId: string | null): ChatRecordView {
    if (typeof window === 'undefined') return 'normal';
    try {
        return parse(window.localStorage.getItem(defaultKeyFor(userId))) ?? 'normal';
    } catch {
        return 'normal';
    }
}

export function writeChatRecordView(userId: string | null, view: ChatRecordView, conversationId: string | null = null): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(conversationId ? conversationKeyFor(userId, conversationId) : defaultKeyFor(userId), view);
    } catch {
        /* 隐私模式：本次会话仍通过事件生效 */
    }
    window.dispatchEvent(new Event(EVENT));
}

/** 「将 X 设为默认」：只改默认值，不改当前会话已经生效的视图。 */
export function writeChatRecordViewDefault(userId: string | null, view: ChatRecordView): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(defaultKeyFor(userId), view);
    } catch {
        /* 隐私模式：本次会话仍通过事件生效 */
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

export function useChatRecordView(userId: string | null, conversationId: string | null = null): ChatRecordView {
    return useSyncExternalStore(subscribe, () => readChatRecordView(userId, conversationId), () => 'normal');
}

/** 新会话默认视图的订阅版本：用于判断当前会话视图是否已偏离默认。 */
export function useChatRecordViewDefault(userId: string | null): ChatRecordView {
    return useSyncExternalStore(subscribe, () => readChatRecordViewDefault(userId), () => 'normal');
}

/**
 * ChatLayout provides the resolved view to the transcript; message components
 * read it without threading the user id through every list row.
 */
export const ChatRecordViewContext = createContext<ChatRecordView>('normal');

export function useTranscriptRecordView(): ChatRecordView {
    return useContext(ChatRecordViewContext);
}
