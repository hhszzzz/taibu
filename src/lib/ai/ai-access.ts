import type { AIModelConfig } from "@/types";
import type { MembershipType } from "@/lib/user/membership";
import { getDefaultModelConfigAsync, getModelConfigAsync } from "@/lib/server/ai-config";
import { getModelUsageType, isUserSelectableUsageType } from "@/lib/ai/source-runtime";

type ModelTier = "free" | "plus" | "pro" | "none";

/** The catalog tier is authoritative; a model without one is unavailable. */
function getModelTier(model: AIModelConfig): ModelTier {
    return model.requiredTier ?? "none";
}

/** Lowest membership that can use a model, shown beside it in the model menu; null when no tier can. */
export function getModelRequiredTier(model: AIModelConfig): Exclude<ModelTier, "none"> | null {
    const tier = getModelTier(model);
    return tier === "none" ? null : tier;
}

export function isModelAllowedForMembership(
    model: AIModelConfig,
    membership: MembershipType
): boolean {
    const tier = getModelTier(model);
    if (tier === "none") return false;

    if (membership === "pro") return true;
    if (membership === "plus") return tier === "free" || tier === "plus";
    return tier === "free";
}

export function isReasoningAllowedForMembership(
    model: AIModelConfig,
    membership: MembershipType
): boolean {
    return model.supportsReasoning && isModelAllowedForMembership(model, membership);
}

export function getModelAccessForMembership(
    model: AIModelConfig,
    membership: MembershipType
): { allowed: boolean; blockedReason: string | null; reasoningAllowed: boolean } {
    const allowed = isModelAllowedForMembership(model, membership);
    const reasoningAllowed = isReasoningAllowedForMembership(model, membership);
    if (allowed) {
        return { allowed, blockedReason: null, reasoningAllowed };
    }

    // 使用数据库配置的 requiredTier 来确定阻止原因
    const tier = getModelTier(model);
    if (tier === "pro") {
        return { allowed, blockedReason: "Pro", reasoningAllowed };
    }

    return { allowed, blockedReason: "Plus", reasoningAllowed };
}

/**
 * 异步版本 - 用于 API 路由
 * 直接使用传入的模型配置（已包含数据库 tier 信息）
 */
export function getModelAccessForMembershipAsync(
    model: AIModelConfig,
    membership: MembershipType
): { allowed: boolean; blockedReason: string | null; reasoningAllowed: boolean } {
    return getModelAccessForMembership(model, membership);
}

type ResolveModelAccessOptions = {
    requireVision?: boolean;
    membershipDeniedMessage?: string;
    invalidModelMessage?: string;
    invalidVisionMessage?: string;
};

/**
 * 异步版本 - 用于 API 路由
 * 确保从数据库加载模型配置
 */
export async function resolveModelAccessAsync(
    modelId: string | undefined,
    defaultModelId: string,
    membership: MembershipType,
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

    if (!isModelAllowedForMembership(modelConfig, membership)) {
        return { error: options?.membershipDeniedMessage ?? "当前会员等级无法使用该模型", status: 403 };
    }

    const reasoningAllowed = isReasoningAllowedForMembership(modelConfig, membership);
    return {
        modelId: modelConfig.id,
        modelConfig,
        reasoningEnabled: reasoningAllowed ? !!reasoning : false,
    };
}
