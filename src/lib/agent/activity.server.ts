import 'server-only';
import type { resolveRequestDbClient } from '@/lib/api-utils';
import { getNotificationRetentionCutoffIso } from '@/lib/notification-server';
import { AGENT_ACTIVITY_LIMIT, parseAgentActivity, type AgentActivity } from './activity';
import { AGENT_ACTIVE_STATUSES } from './types';

type ActivityDb = NonNullable<ReturnType<typeof resolveRequestDbClient>>;
type NoticeRow = { id: unknown; event_data: unknown };

/**
 * Reads with the caller's own client, so row-level security limits both
 * tables to the account; the explicit owner filters keep the indexes usable.
 * Active runs: at most one per conversation (agent_one_active_conversation).
 * Notices: unread rows written for task state changes ('agent:<run>:<status>').
 */
export async function readAgentActivity(db: ActivityDb, userId: string, signal?: AbortSignal): Promise<AgentActivity> {
    let runs = db.from('agent_runs').select('id,conversation_id,status')
        .eq('user_id', userId).in('status', AGENT_ACTIVE_STATUSES)
        .order('updated_at', { ascending: false }).limit(AGENT_ACTIVITY_LIMIT);
    let notices = db.from('notifications').select('id,event_data')
        .eq('user_id', userId).eq('is_read', false).like('event_key', 'agent:%')
        .gte('created_at', getNotificationRetentionCutoffIso())
        .order('created_at', { ascending: false }).limit(AGENT_ACTIVITY_LIMIT);
    if (signal) { runs = runs.abortSignal(signal); notices = notices.abortSignal(signal); }
    const [runRows, noticeRows] = await Promise.all([runs, notices]);
    if (runRows.error || noticeRows.error) throw new Error('AGENT_ACTIVITY_READ_FAILED');
    const activity = parseAgentActivity({
        runs: (runRows.data ?? []).map((row: { id: unknown; conversation_id: unknown; status: unknown }) => ({ runId: row.id, conversationId: row.conversation_id, status: row.status })),
        notices: ((noticeRows.data ?? []) as NoticeRow[]).map(row => {
            const data = typeof row.event_data === 'object' && row.event_data !== null ? row.event_data as Record<string, unknown> : {};
            return data.kind === 'agent' ? { id: row.id, conversationId: data.conversationId, status: data.status } : null;
        }),
    });
    return activity ?? { runs: [], notices: [] };
}
