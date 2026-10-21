import { NextRequest } from 'next/server';
import type { ScopedDb } from '@/lib/db/context.server';
import type { DataSourceType } from '@/lib/data-sources/types';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';
import { VIRTUAL_ARCHIVE_SOURCE_TYPES, buildVirtualArchiveId, isVirtualArchiveSourceType } from '@/lib/knowledge-base/archive-ids';

const DEFAULT_ARCHIVE_LIMIT = 20;
const MAX_ARCHIVE_LIMIT = 100;
const ARCHIVE_FETCH_PADDING = 50;

type ArchiveRow = {
    id: string;
    kb_id: string;
    source_type: string;
    source_id: string;
    created_at: string;
    preview?: string | null;
};

function parseLimit(raw: string | null) {
    const value = Number.parseInt(raw || `${DEFAULT_ARCHIVE_LIMIT}`, 10) || DEFAULT_ARCHIVE_LIMIT;
    return Math.min(Math.max(value, 1), MAX_ARCHIVE_LIMIT);
}

function parseOffset(raw: string | null) {
    return Math.max(Number.parseInt(raw || '0', 10) || 0, 0);
}

function extractPreview(content: string) {
    const aiMarker = 'AI：';
    const aiIndex = content.indexOf(aiMarker);
    const base = aiIndex >= 0 ? content.slice(aiIndex + aiMarker.length) : content;
    const firstParagraph = base.split(/\n{2,}/)[0] || base;
    return firstParagraph.trim();
}

function mergeArchiveRows(baseRows: ArchiveRow[], virtualRows: ArchiveRow[]) {
    const merged = new Map<string, ArchiveRow>();

    for (const row of baseRows) {
        merged.set(`${row.source_type}:${row.source_id}`, row);
    }

    for (const row of virtualRows) {
        const key = `${row.source_type}:${row.source_id}`;
        if (!merged.has(key)) {
            merged.set(key, row);
        }
    }

    return Array.from(merged.values()).sort((left, right) => (
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    ));
}

function toTimestamp(value?: string) {
    if (!value) return Number.NEGATIVE_INFINITY;
    return new Date(value).getTime();
}

async function loadArchivedSourceBatch(
    db: ScopedDb,
    userId: string,
    kbId: string,
    offset: number,
    limit: number,
): Promise<ArchiveRow[]> {
    return await db.tx((trx) => trx
        .selectFrom('archived_sources')
        .select(['id', 'kb_id', 'source_type', 'source_id', 'created_at'])
        .where('user_id', '=', userId)
        .where('kb_id', '=', kbId)
        .orderBy('created_at', 'desc')
        .offset(offset)
        .limit(limit)
        .execute()) as ArchiveRow[];
}

async function loadVirtualArchiveBatch(
    db: ScopedDb,
    kbId: string,
    offset: number,
    limit: number,
): Promise<Array<{ source_type: string; source_id: string; created_at: string }>> {
    // 每个来源恰有一条 chunk_index = 0 的条目（kb_replace_source_entries 按 0 起连续写入分块），
    // 只取首块使分页偏移按来源计数，长文件的大量分块不会拖慢翻页。
    return await db.tx((trx) => trx
        .selectFrom('knowledge_entries')
        .select(['source_type', 'source_id', 'created_at'])
        .where('kb_id', '=', kbId)
        .where('source_type', 'in', [...VIRTUAL_ARCHIVE_SOURCE_TYPES])
        .where('chunk_index', '=', 0)
        .orderBy('created_at', 'desc')
        .offset(offset)
        .limit(limit)
        .execute()) as unknown as Array<{ source_type: string; source_id: string; created_at: string }>;
}

export async function GET(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, scoped: db } = auth;

    const { searchParams } = new URL(request.url);
    const kbId = searchParams.get('kbId');
    const limit = parseLimit(searchParams.get('limit'));
    const offset = parseOffset(searchParams.get('offset'));

    if (kbId) {
        const kb = await db.tx((trx) => trx
            .selectFrom('knowledge_bases')
            .select('id')
            .where('id', '=', kbId)
            .where('user_id', '=', user.id)
            .executeTakeFirst());
        if (!kb) return jsonError('知识库不存在或无权限', 403);
    }
    if (!kbId) {
        let rows;
        try {
            rows = await db.tx((trx) => trx
                .selectFrom('archived_sources')
                .select(['id', 'kb_id', 'source_type', 'source_id', 'created_at'])
                .where('user_id', '=', user.id)
                .orderBy('created_at', 'desc')
                .offset(offset)
                .limit(limit + 1)
                .execute()) as ArchiveRow[];
        } catch {
            return jsonError('获取归档列表失败', 500);
        }

        const hasMore = rows.length > limit;
        const archivedSources = hasMore ? rows.slice(0, limit) : rows;

        return jsonOk({
            archivedSources,
            pagination: {
                hasMore,
                nextOffset: hasMore ? offset + limit : null,
            },
        });
    }

    const batchSize = Math.min(Math.max(limit + ARCHIVE_FETCH_PADDING, DEFAULT_ARCHIVE_LIMIT), MAX_ARCHIVE_LIMIT);
    const targetCount = offset + limit + 1;
    const archivedRows: ArchiveRow[] = [];
    const virtualRows: ArchiveRow[] = [];
    let archivedOffset = 0;
    let virtualOffset = 0;
    let archivedDone = false;
    let virtualDone = false;
    let mergedRows: ArchiveRow[] = [];

    while (!archivedDone || !virtualDone) {
        const archivedBatchPromise = archivedDone
            ? Promise.resolve([] as ArchiveRow[])
            : loadArchivedSourceBatch(db, user.id, kbId, archivedOffset, batchSize);
        const virtualBatchPromise = virtualDone
            ? Promise.resolve([] as Array<{ source_type: string; source_id: string; created_at: string }>)
            : loadVirtualArchiveBatch(db, kbId, virtualOffset, batchSize);

        let archivedBatchRows: ArchiveRow[];
        let virtualBatchData: Array<{ source_type: string; source_id: string; created_at: string }>;
        try {
            [archivedBatchRows, virtualBatchData] = await Promise.all([
                archivedBatchPromise,
                virtualBatchPromise,
            ]);
        } catch {
            return jsonError('获取归档列表失败', 500);
        }

        const virtualBatchRows = virtualBatchData.flatMap((row): ArchiveRow[] => (
            isVirtualArchiveSourceType(row.source_type)
                ? [{
                    id: buildVirtualArchiveId(row.source_type, kbId, row.source_id),
                    kb_id: kbId,
                    source_type: row.source_type,
                    source_id: row.source_id,
                    created_at: row.created_at,
                }]
                : []
        ));

        archivedRows.push(...archivedBatchRows);
        virtualRows.push(...virtualBatchRows);

        archivedOffset += archivedBatchRows.length;
        virtualOffset += virtualBatchData.length;
        archivedDone = archivedBatchRows.length < batchSize;
        virtualDone = virtualBatchData.length < batchSize;

        mergedRows = mergeArchiveRows(archivedRows, virtualRows);

        if (archivedBatchRows.length === 0 && virtualBatchData.length === 0) {
            break;
        }

        if (mergedRows.length < targetCount) {
            continue;
        }

        const cutoffTimestamp = toTimestamp(mergedRows[targetCount - 1]?.created_at);
        const archivedTailTimestamp = toTimestamp(archivedRows[archivedRows.length - 1]?.created_at);
        const virtualTailTimestamp = toTimestamp(virtualRows[virtualRows.length - 1]?.created_at);
        const archivedSafe = archivedDone || archivedTailTimestamp <= cutoffTimestamp;
        const virtualSafe = virtualDone || virtualTailTimestamp <= cutoffTimestamp;

        if (archivedSafe && virtualSafe) {
            break;
        }
    }

    const pageRows = mergedRows.slice(offset, offset + limit);
    const hasMore = mergedRows.length > offset + limit || !archivedDone || !virtualDone;

    if (pageRows.length === 0) {
        return jsonOk({
            archivedSources: [],
            pagination: {
                hasMore: false,
                nextOffset: null,
            },
        });
    }

    const previewSourceIds = Array.from(new Set(pageRows.map((item) => item.source_id)));
    const previewSourceTypes = Array.from(new Set(pageRows.map((item) => item.source_type)));
    const entryPreviews = await db.tx((trx) => trx
        .selectFrom('knowledge_entries')
        .select(['source_type', 'source_id', 'content', 'chunk_index'])
        .where('kb_id', '=', kbId)
        .where('source_id', 'in', previewSourceIds)
        .where('source_type', 'in', previewSourceTypes)
        .where('chunk_index', '=', 0)
        .limit(Math.max(pageRows.length * 2, limit))
        .execute());

    const previewMap = new Map<string, string>();
    entryPreviews.forEach((row) => {
        const key = `${row.source_type}:${row.source_id}`;
        if (!previewMap.has(key)) {
            previewMap.set(key, extractPreview(row.content));
        }
    });

    const archivedSources = pageRows.map((item) => ({
        ...item,
        preview: previewMap.get(`${item.source_type}:${item.source_id}`) || null,
    }));

    return jsonOk({
        archivedSources,
        pagination: {
            hasMore,
            nextOffset: hasMore ? offset + limit : null,
        },
    });
}

export async function POST(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, scoped: db } = auth;

    const body = await request.json() as {
        kbId?: string;
        sourceType?: 'conversation' | 'record' | 'chat_message' | DataSourceType;
        sourceId?: string;
    };

    if (!body.kbId || !body.sourceType || !body.sourceId) {
        return jsonError('参数不完整', 400);
    }

    const kb = await db.tx((trx) => trx
        .selectFrom('knowledge_bases')
        .select('id')
        .where('id', '=', body.kbId as string)
        .where('user_id', '=', user.id)
        .executeTakeFirst());

    if (!kb) {
        return jsonError('知识库不存在或无权限', 403);
    }

    let data;
    try {
        data = await db.tx((trx) => trx
            .insertInto('archived_sources')
            .values({
                user_id: user.id,
                kb_id: body.kbId as string,
                source_type: body.sourceType as string,
                source_id: body.sourceId as string
            })
            .onConflict((oc) => oc.columns(['source_type', 'source_id', 'kb_id']).doUpdateSet({
                user_id: user.id,
            }))
            .returningAll()
            .executeTakeFirst());
    } catch {
        return jsonError('归档失败', 500);
    }

    if (!data) return jsonError('归档失败', 500);
    return jsonOk(data as Record<string, unknown>);
}
