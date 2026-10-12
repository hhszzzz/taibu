'use client';
// Shares the chat sidebar's fold state between the app shell and the chat page.
import { useSyncExternalStore } from 'react';

/**
 * The chat sidebar is either the full list (260px) or the icon rail (60px).
 * The viewer's own choice is kept in this browser; while the task workspace
 * is open beside the conversation the sidebar folds to the rail, unless the
 * viewer unfolds it during that time. Closing the workspace restores the choice.
 */
export type ChatSidebarPreference = 'expanded' | 'collapsed';
export interface ChatSidebarState { preference: ChatSidebarPreference; workspaceOpen: boolean; unfolded: boolean }

const STORAGE_KEY = 'taibu.chat-sidebar';
const SERVER_STATE: ChatSidebarState = { preference: 'expanded', workspaceOpen: false, unfolded: false };

export function isChatSidebarCollapsed(state: ChatSidebarState): boolean {
    return state.preference === 'collapsed' || (state.workspaceOpen && !state.unfolded);
}

export function createChatSidebarStore(storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined) {
    let state: ChatSidebarState | null = null;
    const listeners = new Set<() => void>();
    const read = (): ChatSidebarState => {
        if (state) return state;
        let preference: ChatSidebarPreference = 'expanded';
        try { if (storage()?.getItem(STORAGE_KEY) === 'collapsed') preference = 'collapsed'; } catch { /* Storage may be denied; the default stands. */ }
        return state = { ...SERVER_STATE, preference };
    };
    const update = (next: ChatSidebarState) => {
        const current = read();
        if (current.preference === next.preference && current.workspaceOpen === next.workspaceOpen && current.unfolded === next.unfolded) return;
        state = next;
        if (current.preference !== next.preference) {
            try { storage()?.setItem(STORAGE_KEY, next.preference); } catch { /* The choice still holds for this page. */ }
        }
        listeners.forEach(listener => listener());
    };
    return {
        getSnapshot: read,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        /** Each opening or closing of the workspace starts folded again. */
        setWorkspaceOpen(open: boolean) { const current = read(); if (current.workspaceOpen !== open) update({ ...current, workspaceOpen: open, unfolded: false }); },
        collapse() { update({ ...read(), preference: 'collapsed', unfolded: false }); },
        expand() { const current = read(); update({ ...current, preference: 'expanded', unfolded: current.workspaceOpen }); },
    };
}

const store = createChatSidebarStore(() => (typeof window === 'undefined' ? undefined : window.localStorage));
const getServerSnapshot = () => SERVER_STATE;

export const setChatWorkspaceOpen = store.setWorkspaceOpen;
export const collapseChatSidebar = store.collapse;
export const expandChatSidebar = store.expand;

export function useChatSidebarCollapsed(): boolean {
    return isChatSidebarCollapsed(useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot));
}
