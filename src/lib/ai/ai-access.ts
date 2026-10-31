import type { AIModelConfig } from "@/types";
import { getDefaultModelConfigAsync, getModelConfigAsync } from "@/lib/server/ai-config";
import { getModelUsageType, isUserSelectableUsageType } from "@/lib/ai/source-runtime";
import { isImagePriced, isTextPriced } from "@/lib/billing/pricing";

export const UNPRICED_MODEL_MESSAGE = "该模型尚未定价，暂不可用";

/** The platform offers a model once an administrator priced it: per image for image models, per token otherwise. */
export function isModelOffered(model: AIModelConfig): boolean {
    return getModelUsageType(model) === "image" ? isImagePriced(model.pricing) : isTextPriced(model.pricing);
}

type ResolveModelAccessOptions = {
    requireVision?: boolean;
    invalidModelMessage?: string;
    invalidVisionMessage?: string;
};

/** The requested model, or the default one, when the platform offers it for this use. */
export async function resolveModelAccessAsync(
    modelId: string | undefined,
    defaultModelId: string,
    reasoning?: boolean,
    options?: ResolveModelAccessOptions
): Promise<
    | { modelId: string; modelConfig: AIModelConfig; reasoningEnabled: boolean }
    | { error: string; status: number }
> {
    const requestedModelId = modelId?.trim() || defaultModelId?.trim() || '';
    const modelConfig = requestedModelId
        ? await getModelConfigAsync(requestedModelId)
        : await getDefaultModelConfigAsync('chat', { requireVision: options?.requireVision });
    if (!modelConfig) {
        return { error: options?.invalidModelMessage ?? "模型不可用", status: 400 };
    }
    if (!isUserSelectableUsageType(getModelUsageType(modelConfig))) {
        return { error: options?.invalidModelMessage ?? "模型不可用", status: 400 };
    }

    if (options?.requireVision && !modelConfig.supportsVision) {
        return { error: options?.invalidVisionMessage ?? "请选择支持图像分析的模型", status: 400 };
    }

    if (!isModelOffered(modelConfig)) {
        return { error: UNPRICED_MODEL_MESSAGE, status: 403 };
    }

    return {
        modelId: modelConfig.id,
        modelConfig,
        reasoningEnabled: modelConfig.supportsReasoning ? !!reasoning : false,
    };
}
