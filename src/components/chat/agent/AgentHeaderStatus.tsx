'use client';
// 需要每秒刷新的计时器，显示后台任务已执行时长

import { useSyncExternalStore } from 'react';
import { CirclePause, LoaderCircle } from 'lucide-react';
import { isAgentRunTerminal, type AgentRunStatus } from '@/lib/agent/types';
import { AgentStatus } from './AgentStatus';

function subscribeToSeconds(onChange: () => void) {
    const timer = window.setInterval(onChange, 1000);
    return () => window.clearInterval(timer);
}
const currentSecond = () => Math.floor(Date.now() / 1000);
const serverSecond = () => 0;

export function formatAgentElapsed(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
    return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
}

const idle = () => () => {};

/** Wall-clock time since a task was created, refreshed every second while it is active; null before hydration or without a valid time. */
export function useAgentElapsed(createdAt: string | undefined, active: boolean): string | null {
    const now = useSyncExternalStore(active ? subscribeToSeconds : idle, currentSecond, serverSecond);
    const started = createdAt ? Date.parse(createdAt) : NaN;
    return active && now > 0 && Number.isFinite(started) && now * 1000 >= started ? formatAgentElapsed(now * 1000 - started) : null;
}

/** Header status of the conversation's task: live label and wall-clock time since the task was created, or how long it took once ended. */
export function AgentHeaderStatus({ status, createdAt, reconnecting = false, collaboration, duration = null }: {
    status: AgentRunStatus; createdAt: string; reconnecting?: boolean;
    /** Members finished out of the configured collaborators while their analyses run. */
    collaboration?: { completed: number; total: number };
    /** Measured time an ended task took (getAgentTaskDuration). */
    duration?: number | null;
}) {
    const active = !isAgentRunTerminal(status);
    const elapsed = useAgentElapsed(createdAt, active);
    if (!active) return <AgentStatus status={status} detail={duration === null ? null : formatAgentElapsed(duration)} />;
    const waiting = status === 'awaiting_input';
    if (waiting) return <span className="chat-run-status is-waiting" role="status">
        <CirclePause size={14} aria-hidden="true" /><span>等待你回答 · 任务已暂停</span>
    </span>;
    const label = status === 'queued' ? '等待后台开始' : status === 'cancelling' ? '正在停止' : reconnecting ? '正在重新连接'
        : collaboration ? `协作分析 ${collaboration.completed} / ${collaboration.total}` : '后台执行中';
    return <span className="chat-run-status" role="status">
        <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
        <span>{label}{elapsed && !collaboration ? ` · ${elapsed}` : ''}</span>
    </span>;
}
