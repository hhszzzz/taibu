/**
 * 获取可用的 AI 模型配置
 *
 * 模型目录来自数据库（设置中心「AI 服务」维护），只返回界面需要的公开字段；尚未定价的模型平台不提供，不列出。
 * 管理员没选图标的模型按模型 ID 匹配 lobehub 图标。用户自己的模型见 /api/byok/connections。
 */

import { NextRequest } from 'next/server';
import { getModelsAsync } from '@/lib/server/ai-config';
import { isModelOffered } from '@/lib/ai/ai-access';
import { jsonOk } from '@/lib/api-utils';
import { getModelUsageType, isUserSelectableUsageType } from '@/lib/ai/source-runtime';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { imagePriceMicros, listImageModels } from '@/lib/ai/image-generation.server';
import { matchModelIcon } from '@/lib/ai/lobe-icons';
import { GENERATED_IMAGE_MAX_COUNT, GENERATED_IMAGE_SIZES } from '@/lib/images/generated';

export async function GET(request: NextRequest) {
    const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
    if (featureGuardResponse) return featureGuardResponse;

    const catalog = request.nextUrl.searchParams.get('catalog');

    // 输入框「生图」入口：平台可选的生图模型及其单张价格，第一个是默认。
    if (catalog === 'image') {
        const models = (await listImageModels()).map(model => ({
            id: model.id, name: model.name, vendor: model.vendor, icon: model.icon ?? matchModelIcon(model.modelId) ?? null, priceMicros: imagePriceMicros(model),
        }));
        return jsonOk({ models, sizes: GENERATED_IMAGE_SIZES, maxCount: GENERATED_IMAGE_MAX_COUNT });
    }

    const models = (await getModelsAsync())
        .filter((model) => isUserSelectableUsageType(getModelUsageType(model)) && isModelOffered(model));

    // 返回模型配置（不包含敏感信息）
    return jsonOk({
        models: models.map(m => ({
            id: m.id,
            name: m.name,
            description: m.description ?? null,
            vendor: m.vendor,
            icon: m.icon ?? matchModelIcon(m.modelId) ?? null,
            supportsReasoning: m.supportsReasoning,
            supportsVision: m.supportsVision === true,
            thinkingLevels: m.supportsReasoning ? m.thinkingLevels ?? [] : [],
            defaultThinkingLevel: m.supportsReasoning ? m.defaultReasoningEffort ?? null : null,
            contextWindow: m.contextWindow ?? null,
            maxTokens: m.defaultMaxTokens ?? null,
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
