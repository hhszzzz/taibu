/**
 * 单个 AI 模型网关绑定管理 API
 *
 * PATCH: 更新绑定设置
 * DELETE: 删除绑定
 * POST: 提升该绑定为首选来源
 */
import { NextRequest } from 'next/server';
import { requireAdminUser, jsonError, jsonOk } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { clearModelCache } from '@/lib/server/ai-config';
import { isManagedSourceKey } from '@/lib/ai/source-runtime';

type RouteContext = {
    params: Promise<{ id: string; sourceId: string }>;
};

type BindingIdentityRow = {
    id: string;
    is_enabled: boolean;
    gateway?: { gateway_key: string | null; is_enabled?: boolean | null } | Array<{ gateway_key: string | null; is_enabled?: boolean | null }> | null;
};

function pickGateway(input: BindingIdentityRow['gateway']) {
    if (Array.isArray(input)) {
        return input[0] ?? null;
    }
    return input ?? null;
}

function normalizeOptionalTextField(
    value: unknown,
    fieldName: string,
): { value: string | null | undefined; error: string | null } {
    if (value === undefined) {
        return { value: undefined, error: null };
    }
    if (value === null) {
        return { value: null, error: null };
    }
    if (typeof value !== 'string') {
        return { value: undefined, error: `${fieldName} 必须是字符串或 null` };
    }

    return { value, error: null };
}

async function getBindingIdentity(
    modelId: string,
    sourceId: string,
): Promise<BindingIdentityRow | null> {
    const binding = await systemDb().tx((trx) => trx
        .selectFrom('ai_model_gateway_bindings as binding')
        .leftJoin('ai_gateways as gateway', 'gateway.id', 'binding.gateway_id')
        .select(['binding.id', 'binding.is_enabled', 'gateway.gateway_key', 'gateway.is_enabled as gateway_is_enabled'])
        .where('binding.id', '=', sourceId)
        .where('binding.model_id', '=', modelId)
        .executeTakeFirst()).catch(() => null);

    if (!binding) return null;
    return {
        id: binding.id, is_enabled: binding.is_enabled,
        gateway: binding.gateway_key === null && binding.gateway_is_enabled === null
            ? null
            : { gateway_key: binding.gateway_key, is_enabled: binding.gateway_is_enabled },
    };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
    const authResult = await requireAdminUser(request);
    if ('error' in authResult) {
        return jsonError(authResult.error.message, authResult.error.status);
    }

    const { id: modelId, sourceId } = await context.params;

    try {
        const body = await request.json();
        const updateData: Record<string, unknown> = {};
        if (body.modelIdOverride !== undefined) {
            const normalizedModelIdOverride = normalizeOptionalTextField(body.modelIdOverride, 'modelIdOverride');
            if (normalizedModelIdOverride.error) {
                return jsonError(normalizedModelIdOverride.error, 400);
            }
            updateData.model_id_override = normalizedModelIdOverride.value;
        }
        if (body.reasoningModelId !== undefined) {
            const normalizedReasoningModelId = normalizeOptionalTextField(body.reasoningModelId, 'reasoningModelId');
            if (normalizedReasoningModelId.error) {
                return jsonError(normalizedReasoningModelId.error, 400);
            }
            updateData.reasoning_model_id = normalizedReasoningModelId.value;
        }
        if (body.isEnabled !== undefined) {
            if (typeof body.isEnabled !== 'boolean') {
                return jsonError('isEnabled 必须是布尔值', 400);
            }
            updateData.is_enabled = body.isEnabled;
        }
        if (body.priority !== undefined) {
            if (!Number.isInteger(body.priority) || body.priority < 0) {
                return jsonError('priority 必须是大于等于 0 的整数', 400);
            }
            updateData.priority = body.priority;
        }
        if (body.notes !== undefined) {
            const normalizedNotes = normalizeOptionalTextField(body.notes, 'notes');
            if (normalizedNotes.error) {
                return jsonError(normalizedNotes.error, 400);
            }
            updateData.notes = normalizedNotes.value;
        }

        if (body.isActive !== undefined && body.isActive !== true) {
            return jsonError('isActive 仅支持 true', 400);
        }

        let data: unknown;
        try {
            data = await systemDb().rpc('admin_update_ai_model_binding', {
                p_model_id: modelId,
                p_source_id: sourceId,
                p_patch: updateData,
                p_activate: body.isActive === true,
            });
        } catch (error) {
            console.error('[ai-models] Failed to update binding transactionally:', error);
            return jsonError('更新来源失败', 500);
        }

        const result = (Array.isArray(data) ? data[0] : data) as { status?: string } | null;
        if (!result?.status) {
            console.error('[ai-models] Invalid binding update RPC result:', data);
            return jsonError('更新来源失败', 500);
        }

        if (result.status === 'model_not_found' || result.status === 'not_found') {
            return jsonError('来源不存在', 404);
        }

        if (result.status === 'unsupported_source') {
            return jsonError('仅支持 NewAPI 和 Octopus 来源', 400);
        }

        if (result.status === 'disabled_cannot_activate') {
            return jsonError('无法激活已禁用的来源', 400);
        }

        if (result.status !== 'ok') {
            console.error('[ai-models] Unexpected binding update RPC status:', result.status);
            return jsonError('更新来源失败', 500);
        }

        clearModelCache();

        return jsonOk({ success: true });
    } catch (e) {
        console.error('[ai-models] Invalid request body:', e);
        return jsonError('请求格式错误', 400);
    }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
    const authResult = await requireAdminUser(request);
    if ('error' in authResult) {
        return jsonError(authResult.error.message, authResult.error.status);
    }

    const { id: modelId, sourceId } = await context.params;
    const binding = await getBindingIdentity(modelId, sourceId);

    if (!binding) {
        return jsonError('来源不存在', 404);
    }

    const gateway = pickGateway(binding.gateway);
    if (!gateway || !isManagedSourceKey(gateway.gateway_key)) {
        return jsonError('仅支持 NewAPI 和 Octopus 来源', 400);
    }

    try {
        await systemDb().tx((trx) => trx
            .deleteFrom('ai_model_gateway_bindings')
            .where('id', '=', sourceId)
            .where('model_id', '=', modelId)
            .execute());
    } catch (error) {
        console.error('[ai-models] Failed to delete binding:', error);
        return jsonError('删除来源失败', 500);
    }

    clearModelCache();

    return jsonOk({ success: true });
}

export async function POST(request: NextRequest, context: RouteContext) {
    const authResult = await requireAdminUser(request);
    if ('error' in authResult) {
        return jsonError(authResult.error.message, authResult.error.status);
    }

    const { id: modelId, sourceId } = await context.params;

    let data: unknown;
    try {
        data = await systemDb().rpc('admin_update_ai_model_binding', {
            p_model_id: modelId,
            p_source_id: sourceId,
            p_patch: {},
            p_activate: true,
        });
    } catch (error) {
        console.error('[ai-models] Failed to activate binding transactionally:', error);
        return jsonError('激活来源失败', 500);
    }

    const result = (Array.isArray(data) ? data[0] : data) as { status?: string } | null;
    if (!result?.status) {
        console.error('[ai-models] Invalid binding activate RPC result:', data);
        return jsonError('激活来源失败', 500);
    }

    if (result.status === 'model_not_found' || result.status === 'not_found') {
        return jsonError('来源不存在', 404);
    }

    if (result.status === 'unsupported_source') {
        return jsonError('仅支持 NewAPI 和 Octopus 来源', 400);
    }

    if (result.status === 'disabled_cannot_activate') {
        return jsonError('无法激活已禁用的来源', 400);
    }

    if (result.status !== 'ok') {
        console.error('[ai-models] Unexpected binding activate RPC status:', result.status);
        return jsonError('激活来源失败', 500);
    }

    clearModelCache();

    return jsonOk({ success: true, message: '来源已激活' });
}
