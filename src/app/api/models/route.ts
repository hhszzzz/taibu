/**
 * 获取可用的 AI 模型配置
 *
 * 模型目录来自数据库（设置中心「AI 服务」维护），只返回界面需要的公开字段
 */

import { NextRequest } from 'next/server';
import { getModelsAsync, getModelsByUsageTypeAsync } from '@/lib/server/ai-config';
import type { MembershipType } from '@/lib/user/membership';
import { getEffectiveMembershipType, MembershipResolutionError } from '@/lib/user/membership-server';
import { getModelAccessForMembershipAsync, getModelRequiredTier, isModelAllowedForMembership } from '@/lib/ai/ai-access';
import { getAuthContext, jsonError, jsonOk } from '@/lib/api-utils';
import { getModelUsageType, getOrderedModelSources, isUserSelectableUsageType } from '@/lib/ai/source-runtime';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { imageModelCreditCost } from '@/lib/ai/image-generation.server';
import { GENERATED_IMAGE_MAX_COUNT, GENERATED_IMAGE_SIZES } from '@/lib/images/generated';

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

        // 生图模型单独给输入框的「生图」入口：只列出当前会员可用、且有可调用来源的模型。
        if (catalog === 'image') {
            const membership: MembershipType = auth.user
                ? await getEffectiveMembershipType(auth.user.id, { db: auth.db })
                : 'free';
            const models = (await getModelsByUsageTypeAsync('image'))
                .filter(model => isModelAllowedForMembership(model, membership) && getOrderedModelSources(model).length > 0)
                .map(model => ({
                    id: model.id,
                    name: model.name,
                    vendor: model.vendor,
                    creditCost: imageModelCreditCost(model),
                    tier: getModelRequiredTier(model),
                }));
            return jsonOk({ models, sizes: GENERATED_IMAGE_SIZES, maxCount: GENERATED_IMAGE_MAX_COUNT });
        }

        // 从数据库获取模型配置（带缓存）
        const models = (await getModelsAsync()).filter((model) => isUserSelectableUsageType(getModelUsageType(model)));
        const membership: MembershipType = auth.user
            ? await getEffectiveMembershipType(auth.user.id, { db: auth.db })
            : 'free';

        // 返回模型配置（不包含敏感信息）
        const safeModels = await Promise.all(models.map(async m => {
            const access = await getModelAccessForMembershipAsync(m, membership);
            return {
                id: m.id,
                name: m.name,
                vendor: m.vendor,
                supportsReasoning: m.supportsReasoning,
                thinkingLevels: m.supportsReasoning ? m.thinkingLevels ?? [] : [],
                defaultThinkingLevel: m.supportsReasoning ? m.defaultReasoningEffort ?? null : null,
                contextWindow: m.contextWindow ?? null,
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
