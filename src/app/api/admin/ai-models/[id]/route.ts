/**
 * 单个 AI 模型管理 API
 *
 * PATCH: 更新模型设置
 * DELETE: 删除模型
 */
import { NextRequest } from 'next/server';
import { requireAdminUser, jsonError, jsonOk } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { clearModelCache } from '@/lib/server/ai-config';
import { AI_REASONING_EFFORTS } from '@/types';
import type {
    AIReasoningEffort,
    AIReasoningEffortFormat,
    AIRoutingMode,
    AIUsageType,
} from '@/types';

const VALID_USAGE_TYPES: AIUsageType[] = ['chat', 'vision', 'embedding', 'rerank'];
const VALID_ROUTING_MODES: AIRoutingMode[] = ['auto', 'newapi', 'octopus'];
const VALID_REASONING_EFFORTS: readonly AIReasoningEffort[] = AI_REASONING_EFFORTS;
const VALID_REASONING_EFFORT_FORMATS: AIReasoningEffortFormat[] = ['reasoning_object', 'reasoning_effort'];

function normalizeCustomParameters(input: unknown): Record<string, unknown> | null {
    if (input == null) {
        return null;
    }
    if (typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('customParameters 必须为 JSON 对象');
    }
    return input as Record<string, unknown>;
}

type RouteContext = {
    params: Promise<{ id: string }>;
};

type AdminModelMutationResult = {
    status?: string | null;
    model?: Record<string, unknown> | null;
};

function parseAdminModelMutationResult(value: unknown): AdminModelMutationResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as AdminModelMutationResult;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
    const authResult = await requireAdminUser(request);
    if ('error' in authResult) {
        return jsonError(authResult.error.message, authResult.error.status);
    }

    const { id } = await context.params;

    try {
        const body = await request.json();
        const updateData: Record<string, unknown> = {};

        // 仅更新提供的字段
        if (body.modelKey !== undefined) {
            const normalizedModelKey = typeof body.modelKey === 'string' ? body.modelKey.trim() : '';
            if (!normalizedModelKey) {
                return jsonError('modelKey 不能为空', 400);
            }
            updateData.model_key = normalizedModelKey;
        }
        if (body.displayName !== undefined) updateData.display_name = body.displayName;
        if (body.vendor !== undefined) updateData.vendor = body.vendor;
        if (body.usageType !== undefined) {
            if (!VALID_USAGE_TYPES.includes(body.usageType)) {
                return jsonError('无效的 usageType 值', 400);
            }
            updateData.usage_type = body.usageType;
        }
        if (body.routingMode !== undefined) {
            if (!VALID_ROUTING_MODES.includes(body.routingMode)) {
                return jsonError('无效的 routingMode 值', 400);
            }
            updateData.routing_mode = body.routingMode;
        }
        if (body.isEnabled !== undefined) updateData.is_enabled = body.isEnabled;
        if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder;
        if (body.requiredTier !== undefined) {
            const validTiers = ['free', 'plus', 'pro'];
            if (!validTiers.includes(body.requiredTier)) {
                return jsonError('无效的 requiredTier 值', 400);
            }
            updateData.required_tier = body.requiredTier;
        }
        if (body.supportsReasoning !== undefined) {
            updateData.supports_reasoning = body.supportsReasoning;
            if (body.supportsReasoning === false) {
                updateData.default_reasoning_effort = null;
                updateData.reasoning_effort_format = null;
            }
        }
        if (body.reasoningRequiredTier !== undefined) {
            const validTiers = ['free', 'plus', 'pro'];
            if (!validTiers.includes(body.reasoningRequiredTier)) {
                return jsonError('无效的 reasoningRequiredTier 值', 400);
            }
            updateData.reasoning_required_tier = body.reasoningRequiredTier;
        }
        if (body.isReasoningDefault !== undefined) updateData.is_reasoning_default = body.isReasoningDefault;
        if (body.supportsVision !== undefined) updateData.supports_vision = body.supportsVision;
        if (body.defaultTemperature !== undefined) updateData.default_temperature = body.defaultTemperature;
        if (body.defaultTopP !== undefined) updateData.default_top_p = body.defaultTopP;
        if (body.defaultPresencePenalty !== undefined) updateData.default_presence_penalty = body.defaultPresencePenalty;
        if (body.defaultFrequencyPenalty !== undefined) updateData.default_frequency_penalty = body.defaultFrequencyPenalty;
        if (body.defaultMaxTokens !== undefined) updateData.default_max_tokens = body.defaultMaxTokens;
        if (body.defaultReasoningEffort !== undefined) {
            if (body.defaultReasoningEffort !== null && !VALID_REASONING_EFFORTS.includes(body.defaultReasoningEffort)) {
                return jsonError('无效的 defaultReasoningEffort 值', 400);
            }
            updateData.default_reasoning_effort = body.defaultReasoningEffort;
        }
        if (body.reasoningEffortFormat !== undefined) {
            if (body.reasoningEffortFormat !== null && !VALID_REASONING_EFFORT_FORMATS.includes(body.reasoningEffortFormat)) {
                return jsonError('无效的 reasoningEffortFormat 值', 400);
            }
            updateData.reasoning_effort_format = body.reasoningEffortFormat;
        }
        if (body.customParameters !== undefined) {
            try {
                updateData.custom_parameters = normalizeCustomParameters(body.customParameters);
            } catch (error) {
                return jsonError(error instanceof Error ? error.message : '自定义参数格式错误', 400);
            }
        }
        if (body.description !== undefined) updateData.description = body.description;

        if (Object.keys(updateData).length === 0) {
            return jsonError('没有提供要更新的字段', 400);
        }

        let data: unknown;
        try {
            data = await systemDb().rpc('admin_update_ai_model_and_cleanup_bindings', {
                p_model_id: id,
                p_patch: updateData,
            });
        } catch (error) {
            console.error('[ai-models] Failed to update model transaction:', error);
            return jsonError('更新模型失败', 500);
        }

        const result = parseAdminModelMutationResult(data);
        if (!result?.status) {
            console.error('[ai-models] Invalid update model RPC result:', data);
            return jsonError('更新模型失败', 500);
        }

        if (result.status === 'not_found') {
            return jsonError('模型不存在', 404);
        }

        if (result.status === 'conflict') {
            return jsonError('模型 ID 已存在', 409);
        }

        if (result.status !== 'ok' || !result.model) {
            console.error('[ai-models] Unexpected update model RPC status:', result.status);
            return jsonError('更新模型失败', 500);
        }

        // 清除配置缓存
        clearModelCache();

        return jsonOk({ success: true, model: result.model });
    } catch (e) {
        console.error('[ai-models] Invalid request body:', e);
        return jsonError('请求格式错误', 400);
    }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
    // 验证管理员权限
    const authResult = await requireAdminUser(request);
    if ('error' in authResult) {
        return jsonError(authResult.error.message, authResult.error.status);
    }

    const { id } = await context.params;

    try {
        await systemDb().tx((trx) => trx.deleteFrom('ai_models').where('id', '=', id).execute());
    } catch (error) {
        console.error('[ai-models] Failed to delete model:', error);
        return jsonError('删除模型失败', 500);
    }

    // 清除配置缓存
    clearModelCache();

    return jsonOk({ success: true });
}
