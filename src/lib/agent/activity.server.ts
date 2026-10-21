import 'server-only';
import type { ScopedDb } from '@/lib/db/context.server';
import { getNotificationRetentionCutoffIso } from '@/lib/notification-server';
import { AGENT_ACTIVITY_LIMIT, parseAgentActivity, type AgentActivity } from './activity';
import { AGENT_ACTIVE_STATUSES } from './types';

type NoticeRow = { id: string; event_data: unknown };

/**
 * Reads with the caller's own client, so row-level security limits both
 * tables to the account; the explicit owner filters keep the indexes usable.
 * Active runs: at most one per conversation (agent_one_active_conversation).
 * Notices: unread rows written for task state changes ('agent:<run>:<status>').
 */
export async function readAgentActivity(db: ScopedDb, userId: string, signal?: AbortSignal): Promise<AgentActivity> {
    signal?.throwIfAborted();
    const [runRows, noticeRows] = await Promise.all([
        db.tx(trx => trx.selectFrom('agent_runs').select(['id', 'conversation_id', 'status'])
            .where('user_id', '=', userId).where('status', 'in', [...AGENT_ACTIVE_STATUSES])
            .orderBy('updated_at', 'desc').limit(AGENT_ACTIVITY_LIMIT).execute()),
        db.tx(trx => trx.selectFrom('notifications').select(['id', 'event_data'])
            .where('user_id', '=', userId).where('is_read', '=', false).where('event_key', 'like', 'agent:%')
            .where('created_at', '>=', getNotificationRetentionCutoffIso())
            .orderBy('created_at', 'desc').limit(AGENT_ACTIVITY_LIMIT).execute()),
    ]);
    const activity = parseAgentActivity({
        runs: runRows.map(row => ({ runId: row.id, conversationId: row.conversation_id, status: row.status })),
        notices: (noticeRows as NoticeRow[]).map(row => {
            const data = typeof row.event_data === 'object' && row.event_data !== null ? row.event_data as Record<string, unknown> : {};
            return data.kind === 'agent' ? { id: row.id, conversationId: data.conversationId, status: data.status } : null;
        }),
    });
    return activity ?? { runs: [], notices: [] };
}
