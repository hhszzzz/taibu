import { Check, CircleAlert, Clock3, LoaderCircle, Pause } from 'lucide-react';
import type { AgentRunStatus } from '@/lib/agent/types';
import { agentStatusLabels } from './presentation';

/** Filled square for a stopped task or a step a stop left unfinished. */
export function StoppedGlyph() {
    return <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" rx="2" fill="currentColor" /></svg>;
}

/** One status pill per run state; colors follow the component sheet (warning while waiting, danger on failure). */
export function AgentStatus({ status, detail }: { status: AgentRunStatus; /** Follows the label, as 任务完成 · 1 分 46 秒. */ detail?: string | null }) {
    const icon = status === 'running' || status === 'cancelling'
        ? <LoaderCircle size={12} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : status === 'queued' ? <Clock3 size={12} strokeWidth={2.4} aria-hidden="true" />
        : status === 'awaiting_input' ? <Pause size={12} strokeWidth={2.4} aria-hidden="true" />
        : status === 'completed' ? <Check size={12} strokeWidth={2.8} aria-hidden="true" />
        : status === 'cancelled' ? <StoppedGlyph />
        : <CircleAlert size={12} strokeWidth={2.4} aria-hidden="true" />;
    return (
        <span className={`agent-status agent-status--${status}`} role="status">
            {icon}
            <span>{agentStatusLabels[status]}{detail ? ` · ${detail}` : ''}</span>
        </span>
    );
}
