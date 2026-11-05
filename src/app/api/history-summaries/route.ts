import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import type { ScopedDb } from '@/lib/db/context.server';
import { selectFromDynamic } from '@/lib/db/sql-helpers';
import {
    buildHistoryRestorePayload,
    buildHistorySummary,
    HISTORY_CONFIG,
    isHistoryType,
    type HistoryType,
} from '@/lib/history/registry';

type HistoryRow = Record<string, unknown>;

type AuthenticatedContext = Exclude<Awaited<ReturnType<typeof requireUserContext>>, { error: unknown }>;

function toHistoryRow(value: unknown): HistoryRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as HistoryRow;
}

/** Load the owner-scoped conversation metadata used by history summaries. */
async function attachConversations(db: ScopedDb, rows: HistoryRow[]): Promise<HistoryRow[]> {
    const ids = [...new Set(rows.flatMap((row) => (
        typeof row.conversation_id === 'string' ? [row.conversation_id] : []
    )))];
    if (ids.length === 0) return rows.map((row) => ({ ...row, conversation: null }));

    const conversations = await db.tx((trx) => trx
        .selectFrom('conversations')
        .select(['id', 'source_data'])
        .where('id', 'in', ids)
        .execute());
    const byId = new Map(conversations.map((conversation) => [conversation.id, conversation] as const));
    return rows.map((row) => ({
        ...row,
        conversation: typeof row.conversation_id === 'string' ? byId.get(row.conversation_id) ?? null : null,
    }));
}

async function loadHistoryItems(
    auth: AuthenticatedContext,
    type: HistoryType,
    limit: number,
    offset: number,
) {
    const config = HISTORY_CONFIG[type];
    const result = await auth.db.tx((trx) => selectFromDynamic(trx, config.tableName)
        .select(config.summaryColumns)
        .where('user_id', '=', auth.user.id)
        .orderBy('created_at', 'desc')
        .offset(offset)
        .limit(limit + 1)
        .execute()).then((data) => ({ data, error: null }), (error) => ({ data: null, error }));

    if (result.error || !result.data) {
        return { items: null, pagination: null, error: result.error ?? new Error('missing rows') };
    }

    const rows = result.data.flatMap((item) => {
        const row = toHistoryRow(item);
        return row ? [row] : [];
    });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    try {
        const enriched = await attachConversations(auth.db, pageRows);
        const items = await Promise.all(enriched.map((row) => buildHistorySummary(type, row)));
        return {
            items,
            pagination: {
                hasMore,
                nextOffset: hasMore ? offset + limit : null,
            },
            error: null,
        };
    } catch (error) {
        return { items: null, pagination: null, error };
    }
}

async function loadHistoryRow(
    auth: AuthenticatedContext,
    type: HistoryType,
    id: string,
) {
    const config = HISTORY_CONFIG[type];
    return auth.db.tx((trx) => selectFromDynamic(trx, config.tableName)
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', auth.user.id)
        .executeTakeFirst()).then(
        (data) => ({ row: toHistoryRow(data), error: null }),
        (error) => ({ row: null, error }),
    );
}

export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const id = searchParams.get('id');
    const timezone = searchParams.get('timezone') || 'Asia/Shanghai';
    const limit = Math.min(
        Math.max(Number.parseInt(searchParams.get('limit') || '100', 10) || 100, 1),
        100,
    );
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    if (!isHistoryType(type)) {
        return jsonError('无效的历史类型', 400);
    }

    if (id) {
        const { row, error } = await loadHistoryRow(auth, type, id);
        if (error) {
            console.error('[history-summaries] failed to restore history:', error);
            return jsonError('加载历史记录失败', 500);
        }
        if (!row) {
            return jsonError('未找到历史记录', 404);
        }
        const item = await buildHistoryRestorePayload(type, row, timezone);
        item.sessionData.recordOwnerId = auth.user.id;
        return jsonOk({ item });
    }

    const { items, pagination, error } = await loadHistoryItems(auth, type, limit, offset);
    if (error) {
        console.error('[history-summaries] failed to load history:', error);
        return jsonError('加载历史记录失败', 500);
    }

    return jsonOk({ items: items || [], pagination });
}

export async function DELETE(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const id = searchParams.get('id');

    if (!isHistoryType(type) || !id) {
        return jsonError('缺少有效的历史记录类型或 ID', 400);
    }

    const { row, error: contextError } = await loadHistoryRow(auth, type, id);
    if (contextError) {
        console.error('[history-summaries] failed to load delete context:', contextError);
        return jsonError('删除历史记录失败', 500);
    }
    const conversationId = typeof row?.conversation_id === 'string' ? row.conversation_id : null;

    const { data, error } = await auth.db.rpc('delete_history_item_and_conversation', {
        p_history_type: type,
        p_history_id: id,
    }).then((data) => ({ data, error: null }), (error) => ({ data: null, error }));

    if (error) {
        console.error('[history-summaries] failed to delete history transaction:', error);
        return jsonError('删除历史记录失败', 500);
    }

    if (data !== true) {
        return jsonError('未找到历史记录', 404);
    }

    return jsonOk({
        success: true,
        type,
        id,
        conversationId,
    });
}
