/**
 * 单个 AI 网关管理 API
 *
 * PATCH: 更新网关配置
 */
import { NextRequest } from 'next/server';
import { requireAdminUser, jsonError, jsonOk } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { clearModelCache } from '@/lib/server/ai-config';
import { DEFAULT_AI_TRANSPORT } from '@/lib/ai/source-runtime';

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
    const authResult = await requireAdminUser(request);
    if ('error' in authResult) {
        return jsonError(authResult.error.message, authResult.error.status);
    }

    const { id } = await context.params;

    try {
        const body = await request.json();
        const updateData: Record<string, unknown> = {};

        if (body.displayName !== undefined) updateData.display_name = body.displayName;
        if (body.baseUrl !== undefined) updateData.base_url = body.baseUrl;
        if (body.apiKeyEnvVar !== undefined) updateData.api_key_env_var = body.apiKeyEnvVar;
        if (body.transport !== undefined) {
            if (body.transport !== DEFAULT_AI_TRANSPORT) {
                return jsonError('仅支持 OpenAI 兼容传输协议', 400);
            }
            updateData.transport = body.transport;
        }
        if (body.isEnabled !== undefined) updateData.is_enabled = body.isEnabled;
        if (body.notes !== undefined) updateData.notes = body.notes;

        if (Object.keys(updateData).length === 0) {
            return jsonError('没有提供要更新的字段', 400);
        }

        const gateway = await systemDb().tx((trx) => trx
            .updateTable('ai_gateways')
            .set(updateData)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst());

        if (!gateway) {
            console.error('[ai-gateways] Failed to update gateway: not found');
            return jsonError('更新网关失败', 500);
        }

        clearModelCache();

        return jsonOk({ success: true, gateway });
    } catch (e) {
        console.error('[ai-gateways] Invalid request body:', e);
        return jsonError('请求格式错误', 400);
    }
}
