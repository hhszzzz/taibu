import { NextRequest } from 'next/server';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';
import { normalizeKnowledgeBaseInput } from '@/lib/knowledge-base/ingest';
import { KNOWLEDGE_BASE_LIMIT } from '@/lib/knowledge-base/types';

export async function GET(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, db: scoped } = auth;

    try {
        const knowledgeBases = await scoped.tx((trx) => trx
            .selectFrom('knowledge_bases')
            .selectAll()
            .where('user_id', '=', user.id)
            .orderBy('created_at', 'desc')
            .execute());
        return jsonOk({ knowledgeBases });
    } catch {
        return jsonError('获取知识库失败', 500);
    }
}

export async function POST(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, db: scoped } = auth;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonError('请求体不是合法 JSON', 400);
    }
    const normalized = normalizeKnowledgeBaseInput(body, 'create');
    if ('error' in normalized) {
        return jsonError(normalized.error, 400);
    }

    let data: unknown;
    try {
        data = await scoped.rpc('create_knowledge_base_with_limit', {
            p_user_id: user.id,
            p_name: normalized.data.name as string,
            p_description: normalized.data.description ?? null,
            p_weight: normalized.data.weight ?? 'normal',
            p_limit: KNOWLEDGE_BASE_LIMIT,
        });
    } catch (error) {
        console.error('[knowledge-base] Failed to create knowledge base transactionally:', error);
        return jsonError('创建知识库失败', 500);
    }

    const result = (Array.isArray(data) ? data[0] : data) as {
        status?: string;
        knowledge_base?: Record<string, unknown> | null;
    } | null;
    if (result?.status === 'limit_reached') {
        return jsonError('知识库数量已达上限', 403);
    }

    if (result?.status !== 'ok' || !result.knowledge_base) {
        console.error('[knowledge-base] Invalid create knowledge base RPC result:', data);
        return jsonError('创建知识库失败', 500);
    }

    return jsonOk(result.knowledge_base);
}
