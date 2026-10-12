'use client';
// 需要 React context，让聊天里的步骤与成果卡片打开并标记工作区当前视图
import { createContext, useContext } from 'react';

/** What the open workspace shows: the step the reader is on and every tool call of that view. */
export interface AgentWorkspaceShown {
    toolId: string | null;
    toolIds: ReadonlySet<string>;
    /** The citation whose source is open, so the answer can mark its badge. */
    cite?: number | null;
}

export interface AgentResultWorkspace {
    openResource: (id: string) => void;
    /** Absent or null while the workspace is closed or shows a section rather than a tool view. */
    shown?: AgentWorkspaceShown | null;
}

export const AgentResultContext = createContext<AgentResultWorkspace | null>(null);
export const useAgentResultWorkspace = () => useContext(AgentResultContext);

export function isSameWorkspaceShown(left: AgentWorkspaceShown | null, right: AgentWorkspaceShown | null) {
    if (left === right) return true;
    if (!left || !right || left.toolId !== right.toolId || (left.cite ?? null) !== (right.cite ?? null) || left.toolIds.size !== right.toolIds.size) return false;
    for (const id of left.toolIds) if (!right.toolIds.has(id)) return false;
    return true;
}
