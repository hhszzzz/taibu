/**
 * 获取可用的 AI 模型配置
 *
 * 模型目录来自数据库（设置中心「AI 服务」维护），只返回界面需要的公开字段；尚未定价的模型平台不提供，不列出。
 */

import { NextRequest } from 'next/server';
import { getModelsAsync } from '@/lib/server/ai-config';
import { isModelOffered } from '@/lib/ai/ai-access';
import { jsonOk } from '@/lib/api-utils';
import { getModelUsageType, isUserSelectableUsageType } from '@/lib/ai/source-runtime';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { imagePriceMicros, resolveImageModel } from '@/lib/ai/image-generation.server';
import { GENERATED_IMAGE_MAX_COUNT, GENERATED_IMAGE_SIZES } from '@/lib/images/generated';

export async function GET(request: NextRequest) {
    const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
    if (featureGuardResponse) return featureGuardResponse;

    const catalog = request.nextUrl.searchParams.get('catalog');

    // BYOK 目录独立于本站定价，只暴露聊天模型的安全元数据。
    if (catalog === 'byok') {
        const models = (await getModelsAsync()).filter((model) => getModelUsageType(model) === 'chat');
        const dedupedModels = new Map<string, {
            id: string;
            name: string;
            vendor: string;
            icon: string | null;
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
                icon: model.icon ?? null,
                supportsReasoning: model.supportsReasoning,
                isReasoningDefault: model.isReasoningDefault ?? false,
            });
        }

        return jsonOk({ models: Array.from(dedupedModels.values()) });
    }

    // 输入框「生图」入口：平台实际使用的生图模型及其单张价格。
    if (catalog === 'image') {
        const model = await resolveImageModel();
        const models = model ? [{ id: model.id, name: model.name, vendor: model.vendor, priceMicros: imagePriceMicros(model) }] : [];
        return jsonOk({ models, sizes: GENERATED_IMAGE_SIZES, maxCount: GENERATED_IMAGE_MAX_COUNT });
    }

    const models = (await getModelsAsync())
        .filter((model) => isUserSelectableUsageType(getModelUsageType(model)) && isModelOffered(model));

    // 返回模型配置（不包含敏感信息）
    return jsonOk({
        models: models.map(m => ({
            id: m.id,
            name: m.name,
            vendor: m.vendor,
            icon: m.icon ?? null,
            supportsReasoning: m.supportsReasoning,
            supportsVision: m.supportsVision === true,
            thinkingLevels: m.supportsReasoning ? m.thinkingLevels ?? [] : [],
            defaultThinkingLevel: m.supportsReasoning ? m.defaultReasoningEffort ?? null : null,
            contextWindow: m.contextWindow ?? null,
            isReasoningDefault: m.isReasoningDefault,
            pricing: {
                input: m.pricing?.input ?? 0,
                output: m.pricing?.output ?? 0,
                cacheRead: m.pricing?.cacheRead ?? null,
                cacheWrite: m.pricing?.cacheWrite ?? null,
            },
        })),
    });
}
