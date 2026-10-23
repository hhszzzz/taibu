'use client';
// 需要每秒刷新的计时器，显示后台任务已执行时长

import { CirclePause, LoaderCircle } from 'lucide-react';
import { isAgentRunTerminal, type AgentRunStatus } from '@/lib/agent/types';
import { AgentStatus } from './AgentStatus';

export function formatAgentElapsed(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
    return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
}

/** Header status of the conversation's task: live label while it runs, terminal label once it ends.
    任务用时（elapsed / duration）只落库，不展示给用户（用户裁定 2026-10-17，对齐 claude）。 */
export function AgentHeaderStatus({ status, reconnecting = false, collaboration }: {
    status: AgentRunStatus; reconnecting?: boolean;
    /** Members finished out of the configured collaborators while their analyses run. */
    collaboration?: { completed: number; total: number };
}) {
    const active = !isAgentRunTerminal(status);
    if (!active) return <AgentStatus status={status} />;
    const waiting = status === 'awaiting_input';
    if (waiting) return <span className="chat-run-status is-waiting" role="status">
        <CirclePause size={14} aria-hidden="true" /><span>等待你回答 · 任务已暂停</span>
    </span>;
    const label = status === 'queued' ? '等待后台开始' : status === 'cancelling' ? '正在停止' : reconnecting ? '正在重新连接'
        : collaboration ? `协作分析 ${collaboration.completed} / ${collaboration.total}` : '后台执行中';
    return <span className="chat-run-status" role="status">
        <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
        <span>{label}</span>
    </span>;
}
