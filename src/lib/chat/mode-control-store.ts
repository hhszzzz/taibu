/**
 * 「对话方式」（Agent / 对话）控件的跨组件通道。
 *
 * 状态由 /chat 页面持有（useChatState）；桌面侧栏与移动抽屉都渲染在页面外壳上，
 * 通过这个极小的外部 store 读取同一份控件，从而保证全页「对话方式」单选组恰好一个，
 * 且与页内偏好实时同步（切换后页面与侧栏一致）。
 *
 * 快照只含取值（mode / 禁用位）：回调单独存放，避免 /chat 每次按键重渲染时
 * 因回调身份变化而扰动订阅者。
 *
 * 'use client' 标记说明：
 * - 依赖 useSyncExternalStore 订阅
 */
'use client';

import { useSyncExternalStore } from 'react';

/** 快照：触发重渲染的取值。 */
export interface ChatModeSnapshot {
    mode: 'agent' | 'plain';
    agentDisabled: boolean;
    plainDisabled: boolean;
}

/** /chat 发布的完整控件（含回调）。 */
export interface ChatModeControl extends ChatModeSnapshot {
    onChange: (mode: 'agent' | 'plain') => void;
}

let current: ChatModeSnapshot | null = null;
let changeMode: ((mode: 'agent' | 'plain') => void) | null = null;
const listeners = new Set<() => void>();

const emit = () => {
    for (const listener of listeners) listener();
};

/** /chat 每次渲染都可以调用；取值未变时不通知订阅者。 */
export function publishChatModeControl(next: ChatModeControl | null): void {
    changeMode = next?.onChange ?? null;
    if (!next) {
        if (current === null) return;
        current = null;
        emit();
        return;
    }
    const previous = current;
    if (previous && previous.mode === next.mode
        && previous.agentDisabled === next.agentDisabled
        && previous.plainDisabled === next.plainDisabled) return;
    current = { mode: next.mode, agentDisabled: next.agentDisabled, plainDisabled: next.plainDisabled };
    emit();
}

/** 切换对话方式（由控件调用；离开 /chat 后由全局回退控件接管）。 */
export function setChatMode(mode: 'agent' | 'plain'): void {
    changeMode?.(mode);
}

/**
 * 本地偏好键——与 `use-agent-chat` 的持久化共用同一个键，
 * 全站侧栏在 /chat 之外读它显示当前「对话方式」。
 */
const MODE_STORAGE_PREFIX = 'taibu:agent-mode:';

/** 读取「对话方式」的本地偏好（无记录 = 对话，与 /chat 的默认一致）。 */
export function readStoredChatMode(userId: string | null | undefined): 'agent' | 'plain' {
    if (!userId || typeof window === 'undefined') return 'plain';
    try {
        return window.localStorage.getItem(`${MODE_STORAGE_PREFIX}${userId}`) === 'agent' ? 'agent' : 'plain';
    } catch {
        return 'plain';
    }
}

/** /chat 之外切换时落盘：回到 /chat 后由页面读同一份偏好生效。 */
export function persistStoredChatMode(userId: string | null | undefined, mode: 'agent' | 'plain'): void {
    if (!userId || typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(`${MODE_STORAGE_PREFIX}${userId}`, mode);
    } catch {
        /* 隐私模式下写不进去；切换仍然通过路由生效 */
    }
}

/** 新建会话的地址：沿用当前对话方式，Agent 带 `?mode=agent`。 */
export function newChatHref(mode: 'agent' | 'plain'): string {
    return mode === 'agent' ? '/chat?mode=agent' : '/chat';
}

/** /chat 内读页内控件，其它页面读本地偏好：新建会话时据此决定用哪种方式。 */
export function useCurrentChatMode(userId: string | null | undefined): 'agent' | 'plain' {
    const control = useChatModeControl();
    const stored = useStoredChatMode(userId);
    return control?.mode ?? stored;
}

/** 离开 /chat 时清空，侧栏的空位随之收起。 */
export function clearChatModeControl(): void {
    publishChatModeControl(null);
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
const getSnapshot = () => current;
const getServerSnapshot = () => null;

export function useChatModeControl(): ChatModeSnapshot | null {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * /chat 之外的页面读「对话方式」：本地偏好作为快照（SSR 用默认 agent），
 * 页内切换会经 store 的 emit 让订阅者重新读取。
 */
export function useStoredChatMode(userId: string | null | undefined): 'agent' | 'plain' {
    return useSyncExternalStore(subscribe, () => readStoredChatMode(userId), () => 'plain' as const);
}
