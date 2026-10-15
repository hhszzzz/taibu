import type { AIModelConfig } from "@/types";
import type { MembershipType } from "@/lib/user/membership";
import { getDefaultModelConfigAsync, getModelConfigAsync } from "@/lib/server/ai-config";
import { getModelUsageType, isUserSelectableUsageType } from "@/lib/ai/source-runtime";

type ModelTier = "free" | "plus" | "pro" | "none";

/** 默认 vendor -> tier 映射（当数据库未配置 requiredTier 时的回退） */
const VENDOR_DEFAULT_TIER: Record<string, ModelTier> = {
    deepai: "pro",
    gemini: "plus",
    qwen: "plus",
    moonshot: "free",
    "qwen-vl": "plus",
    "gemini-vl": "plus",
};

/** DeepSeek 模型 ID -> tier 映射 */
const DEEPSEEK_MODEL_TIER: Record<string, ModelTier> = {
    "deepseek-v3.2": "free",
    "deepseek-pro": "plus",
};

/** GLM 模型 ID -> tier 映射 */
const GLM_MODEL_TIER: Record<string, ModelTier> = {
    "glm-4.6": "free",
};

/**
 * 获取模型所需等级（优先使用数据库配置）
 */
function getModelTier(model: AIModelConfig): ModelTier {
    // 优先使用数据库配置的 requiredTier
    if (model.requiredTier) {
        return model.requiredTier;
    }

    // 回退到集中配置的 vendor 映射
    if (model.vendor === "deepseek") {
        return DEEPSEEK_MODEL_TIER[model.id] ?? "none";
    }

    if (model.vendor === "glm") {
        return GLM_MODEL_TIER[model.id] ?? "plus";
    }

    return VENDOR_DEFAULT_TIER[model.vendor] ?? "none";
}

/**
 * 获取推理模式所需等级（优先使用数据库配置）
 */
function getReasoningTier(model: AIModelConfig): ModelTier {
    // 优先使用数据库配置的 reasoningRequiredTier
    if (model.reasoningRequiredTier) {
        return model.reasoningRequiredTier;
    }

    // 回退到硬编码逻辑
    if (model.vendor === "deepai") {
        return "pro";
    }

    // 默认 plus 可用
    return "plus";
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
    if (!model.supportsReasoning) return false;

    // 使用数据库配置的 reasoningRequiredTier
    const reasoningTier = getReasoningTier(model);

    if (membership === "pro") return true;
    if (membership === "plus") return reasoningTier === "free" || reasoningTier === "plus";
    return reasoningTier === "free";
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
    const fallbackUsageType = options?.requireVision ? 'vision' : 'chat';
    const modelConfig = requestedModelId
        ? await getModelConfigAsync(requestedModelId)
        : await getDefaultModelConfigAsync(fallbackUsageType);
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
