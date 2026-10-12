/**
 * Sidebar task markers: which conversations have an Agent task running or
 * waiting for an answer, and which finished in the background with an answer
 * the user has not opened yet.
 *
 * GET /api/agent/activity returns the account's active runs and its unread
 * task notices (written by the agent_task_notification trigger); this module
 * validates that payload and turns it into one marker per conversation.
 */
import { isValidUUID } from '@/lib/validation';
import type { AgentRunStatus } from './types';

export type AgentActivityRunStatus = Extract<AgentRunStatus, 'queued' | 'running' | 'awaiting_input' | 'cancelling'>;
export type AgentActivityNoticeStatus = 'completed' | 'failed' | 'awaiting_input';
export interface AgentActivityRun { runId: string; conversationId: string; status: AgentActivityRunStatus }
export interface AgentActivityNotice { id: string; conversationId: string; status: AgentActivityNoticeStatus }
export interface AgentActivity { runs: AgentActivityRun[]; notices: AgentActivityNotice[] }
export type ConversationAgentMarker = 'running' | 'awaiting' | 'answered';

/** Rows read per kind; an account rarely has more than a few at once. */
export const AGENT_ACTIVITY_LIMIT = 50;
export const AGENT_MARKER_LABELS: Record<ConversationAgentMarker, string> = {
    running: 'Agent 正在执行',
    awaiting: '待回答',
    answered: '任务已完成，有新回答',
};

const RUN_STATUSES = new Set<string>(['queued', 'running', 'awaiting_input', 'cancelling'] satisfies AgentActivityRunStatus[]);
const NOTICE_STATUSES = new Set<string>(['completed', 'failed', 'awaiting_input'] satisfies AgentActivityNoticeStatus[]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && isValidUUID(value);

/** Keeps well-formed entries only; anything else in the payload is ignored. */
export function parseAgentActivity(value: unknown): AgentActivity | null {
    if (!isRecord(value) || !Array.isArray(value.runs) || !Array.isArray(value.notices)) return null;
    const runs = value.runs.flatMap((run): AgentActivityRun[] => isRecord(run) && isId(run.runId) && isId(run.conversationId) && typeof run.status === 'string' && RUN_STATUSES.has(run.status)
        ? [{ runId: run.runId, conversationId: run.conversationId, status: run.status as AgentActivityRunStatus }]
        : []);
    const notices = value.notices.flatMap((notice): AgentActivityNotice[] => isRecord(notice) && isId(notice.id) && isId(notice.conversationId) && typeof notice.status === 'string' && NOTICE_STATUSES.has(notice.status)
        ? [{ id: notice.id, conversationId: notice.conversationId, status: notice.status as AgentActivityNoticeStatus }]
        : []);
    return { runs: runs.slice(0, AGENT_ACTIVITY_LIMIT), notices: notices.slice(0, AGENT_ACTIVITY_LIMIT) };
}

/**
 * A live task outranks an unread notice: a conversation that is running again
 * shows the spinner, not the earlier completion. The conversation on screen
 * never shows the unread dot because opening it is what reads the notice.
 */
export function getConversationAgentMarkers(activity: AgentActivity | null, viewingConversationId?: string | null): ReadonlyMap<string, ConversationAgentMarker> {
    const markers = new Map<string, ConversationAgentMarker>();
    if (!activity) return markers;
    for (const notice of activity.notices)
        if (notice.status === 'completed' && notice.conversationId !== viewingConversationId) markers.set(notice.conversationId, 'answered');
    for (const run of activity.runs) markers.set(run.conversationId, run.status === 'awaiting_input' ? 'awaiting' : 'running');
    return markers;
}

/** Unread task notices of one conversation, read together when it is opened. */
export function getConversationNoticeIds(activity: AgentActivity | null, conversationId: string | null | undefined): string[] {
    if (!activity || !conversationId) return [];
    return activity.notices.flatMap(notice => notice.conversationId === conversationId ? [notice.id] : []);
}

/** Polls quickly only while something can change on its own. */
export function getAgentActivityPollDelay(activity: AgentActivity | null): number {
    return activity?.runs.length ? 10_000 : 60_000;
}
