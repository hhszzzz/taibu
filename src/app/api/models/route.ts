/**
 * 获取可用的 AI 模型配置
 *
 * 这个 API 在服务端运行，可以访问所有环境变量
 * 优先从数据库获取配置，环境变量作为回退
 */

import { NextRequest } from 'next/server';
import { getModelsAsync } from '@/lib/server/ai-config';
import type { MembershipType } from '@/lib/user/membership';
import { getEffectiveMembershipType, MembershipResolutionError } from '@/lib/user/membership-server';
import { getModelAccessForMembershipAsync, getModelRequiredTier } from '@/lib/ai/ai-access';
import { getAuthContext, jsonError, jsonOk } from '@/lib/api-utils';
import { getModelUsageType, isUserSelectableUsageType } from '@/lib/ai/source-runtime';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';

export async function GET(request: NextRequest) {
    try {
        const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
        if (featureGuardResponse) return featureGuardResponse;

        const catalog = request.nextUrl.searchParams.get('catalog');

        // BYOK 目录独立于本站会员限制，只暴露聊天模型的安全元数据。
        if (catalog === 'byok') {
            const models = (await getModelsAsync()).filter((model) => getModelUsageType(model) === 'chat');
            const dedupedModels = new Map<string, {
                id: string;
                name: string;
                vendor: string;
                supportsReasoning: boolean;
                isReasoningDefault: boolean;
            }>();

            for (const model of models) {
                const modelId = model.modelId || model.id;
                if (!modelId || dedupedModels.has(modelId)) continue;
                dedupedModels.set(modelId, {
                    id: modelId,
                    name: model.name,
                    vendor: model.vendor,
                    supportsReasoning: model.supportsReasoning,
                    isReasoningDefault: model.isReasoningDefault ?? false,
                });
            }

            return jsonOk({ models: Array.from(dedupedModels.values()) });
        }

        const auth = await getAuthContext(request);
        if (auth.authError) {
            return jsonError(auth.authError.message, auth.authError.status);
        }

        // 从数据库获取模型配置（带缓存）
        const models = (await getModelsAsync()).filter((model) => isUserSelectableUsageType(getModelUsageType(model)));
        const membership: MembershipType = auth.user
            ? await getEffectiveMembershipType(auth.user.id, { client: auth.db })
            : 'free';

        // 返回模型配置（不包含敏感信息）
        const safeModels = await Promise.all(models.map(async m => {
            const access = await getModelAccessForMembershipAsync(m, membership);
            return {
                id: m.id,
                name: m.name,
                vendor: m.vendor,
                supportsReasoning: m.supportsReasoning,
                reasoningEffortFormat: m.reasoningEffortFormat ?? null,
                isReasoningDefault: m.isReasoningDefault,
                allowed: access.allowed,
                tier: getModelRequiredTier(m),
                blockedReason: access.blockedReason,
                reasoningAllowed: access.reasoningAllowed,
            };
        }));

        return jsonOk({ models: safeModels });
    } catch (error) {
        if (error instanceof MembershipResolutionError) {
            return jsonError(error.message, 500);
        }
        throw error;
    }
}
