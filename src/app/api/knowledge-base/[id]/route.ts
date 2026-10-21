import { NextRequest } from 'next/server';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';
import { normalizeKnowledgeBaseInput } from '@/lib/knowledge-base/ingest';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(_request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, scoped } = auth;

    const { id } = await params;
    let data;
    try {
        data = await scoped.tx((trx) => trx
            .selectFrom('knowledge_bases')
            .selectAll()
            .where('id', '=', id)
            .where('user_id', '=', user.id)
            .executeTakeFirst());
    } catch {
        return jsonError('获取知识库失败', 500);
    }

    if (!data) return jsonError('知识库不存在', 404);
    return jsonOk(data as Record<string, unknown>);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, scoped } = auth;

    const { id } = await params;
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonError('请求体不是合法 JSON', 400);
    }
    const normalized = normalizeKnowledgeBaseInput(body, 'update');
    if ('error' in normalized) {
        return jsonError(normalized.error, 400);
    }
    const updateData = {
        ...normalized.data,
        updated_at: new Date().toISOString(),
    };

    let data;
    try {
        data = await scoped.tx((trx) => trx
            .updateTable('knowledge_bases')
            .set(updateData)
            .where('id', '=', id)
            .where('user_id', '=', user.id)
            .returningAll()
            .executeTakeFirst());
    } catch {
        return jsonError('更新知识库失败', 500);
    }

    if (!data) return jsonError('知识库不存在', 404);
    return jsonOk(data as Record<string, unknown>);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(_request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, scoped } = auth;

    const { id } = await params;
    let data;
    try {
        data = await scoped.tx((trx) => trx
            .deleteFrom('knowledge_bases')
            .where('id', '=', id)
            .where('user_id', '=', user.id)
            .returning('id')
            .execute());
    } catch {
        return jsonError('删除知识库失败', 500);
    }

    if (!Array.isArray(data) || data.length === 0) return jsonError('知识库不存在', 404);
    return jsonOk({ success: true });
}
