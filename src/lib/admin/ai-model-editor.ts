import { getVendorName, VENDOR_PRESETS as VENDOR_PRESET_KEYS } from '@/lib/ai/vendor-labels';

// 类型定义
export interface ModelSource {
    id: string;
    sourceKey: string;
    sourceName: string;
    apiUrl: string;
    apiKeyEnvVar: string;
    transport?: 'openai_compatible';
    hasApiKey: boolean;
    modelIdOverride: string | null;
    reasoningModelId: string | null;
    isActive: boolean;
    isEnabled: boolean;
    priority: number;
    notes: string | null;
}

export interface AIModel {
    id: string;
    modelKey: string;
    displayName: string;
    vendor: string;
    usageType: 'chat' | 'vision' | 'embedding' | 'rerank';
    routingMode: 'auto' | 'newapi' | 'octopus';
    isEnabled: boolean;
    sortOrder: number;
    requiredTier: 'free' | 'plus' | 'pro';
    supportsReasoning: boolean;
    reasoningRequiredTier: string;
    isReasoningDefault: boolean;
    supportsVision: boolean;
    defaultTemperature: number;
    defaultTopP: number | null;
    defaultPresencePenalty: number | null;
    defaultFrequencyPenalty: number | null;
    defaultMaxTokens: number | null;
    defaultReasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | null;
    reasoningEffortFormat: 'reasoning_object' | 'reasoning_effort' | null;
    customParameters: Record<string, unknown> | null;
    description: string | null;
    sources: ModelSource[];
}

export type CreateVendorPreset = string;

export type ManagedGatewayKey = 'newapi' | 'octopus';

export type CreateModelDraft = {
    modelKey: string;
    displayName: string;
    vendorPreset: CreateVendorPreset;
    customVendor: string;
    usageType: AIModel['usageType'];
    routingMode: AIModel['routingMode'];
    primaryGatewayKey: ManagedGatewayKey;
    requiredTier: AIModel['requiredTier'];
    supportsReasoning: boolean;
    reasoningRequiredTier: string;
    isReasoningDefault: boolean;
    supportsVision: boolean;
    defaultTemperature: number;
    defaultTopP: number | null;
    defaultPresencePenalty: number | null;
    defaultFrequencyPenalty: number | null;
    defaultMaxTokens: number | null;
    defaultReasoningEffort: AIModel['defaultReasoningEffort'];
    reasoningEffortFormat: AIModel['reasoningEffortFormat'];
    customParametersText: string;
    description: string;
};

export type SourceDraft = {
    modelIdOverride: string;
    reasoningModelId: string;
    priority: number;
    isEnabled: boolean;
    notes: string;
};

export type EditModelDraft = {
    modelKey: string;
    displayName: string;
    vendorPreset: CreateVendorPreset;
    customVendor: string;
    usageType: AIModel['usageType'];
    routingMode: AIModel['routingMode'];
    requiredTier: AIModel['requiredTier'];
    sortOrder: number;
    supportsReasoning: boolean;
    reasoningRequiredTier: string;
    isReasoningDefault: boolean;
    supportsVision: boolean;
    defaultTemperature: number;
    defaultTopP: number | null;
    defaultPresencePenalty: number | null;
    defaultFrequencyPenalty: number | null;
    defaultMaxTokens: number | null;
    defaultReasoningEffort: AIModel['defaultReasoningEffort'];
    reasoningEffortFormat: AIModel['reasoningEffortFormat'];
    customParametersText: string;
    description: string;
};

/** Merge refreshed server fields without discarding unrelated in-progress edits. */
export function reconcileModelDrafts(
    current: Record<string, EditModelDraft>,
    previous: Record<string, EditModelDraft>,
    incoming: Record<string, EditModelDraft>,
): Record<string, EditModelDraft> {
    return Object.fromEntries(Object.entries(incoming).map(([id, fresh]) => {
        const draft = current[id];
        const baseline = previous[id];
        if (!draft || !baseline) return [id, fresh];
        const dirty = Object.fromEntries(
            (Object.keys(draft) as Array<keyof EditModelDraft>)
                .filter(key => draft[key] !== baseline[key])
                .map(key => [key, draft[key]]),
        );
        return [id, { ...fresh, ...dirty }];
    }));
}

export const TIER_LABELS: Record<string, { label: string; color: string }> = {
    free: { label: 'Free', color: 'text-gray-500 bg-gray-500/10' },
    plus: { label: 'Plus', color: 'text-amber-500 bg-amber-500/10' },
    pro: { label: 'Pro', color: 'text-purple-500 bg-purple-500/10' },
};

export const VENDOR_PRESETS: Array<{ value: string; label: string }> =
    VENDOR_PRESET_KEYS.map(v => ({ value: v, label: getVendorName(v) }));

export const USAGE_TYPE_LABELS: Record<AIModel['usageType'], string> = {
    chat: '聊天',
    vision: '视觉',
    embedding: 'Embedding',
    rerank: 'Rerank',
};

export const ROUTING_MODE_LABELS: Record<AIModel['routingMode'], string> = {
    auto: '自动故障转移',
    newapi: '固定 NewAPI',
    octopus: '固定 Octopus',
};

export function createInitialNewModel(): CreateModelDraft {
    return {
        modelKey: '',
        displayName: '',
        vendorPreset: 'deepseek',
        customVendor: '',
        usageType: 'chat',
        routingMode: 'auto',
        primaryGatewayKey: 'newapi',
        requiredTier: 'free',
        supportsReasoning: false,
        reasoningRequiredTier: 'plus',
        isReasoningDefault: false,
        supportsVision: false,
        defaultTemperature: 0.7,
        defaultTopP: null,
        defaultPresencePenalty: null,
        defaultFrequencyPenalty: null,
        defaultMaxTokens: null,
        defaultReasoningEffort: null,
        reasoningEffortFormat: 'reasoning_object',
        customParametersText: '',
        description: '',
    };
}

export function resolveDraftVendor(model: Pick<CreateModelDraft, 'vendorPreset' | 'customVendor'>): string {
    return model.vendorPreset === '__custom__'
        ? model.customVendor.trim()
        : model.vendorPreset;
}

export function resolveVendorDraft(vendor: string): Pick<EditModelDraft, 'vendorPreset' | 'customVendor'> {
    const matchedPreset = VENDOR_PRESETS.find((preset) => preset.value === vendor);
    if (matchedPreset) {
        return {
            vendorPreset: matchedPreset.value,
            customVendor: '',
        };
    }
    return {
        vendorPreset: '__custom__',
        customVendor: vendor,
    };
}

export function createEditModelDraft(model: AIModel): EditModelDraft {
    return {
        modelKey: model.modelKey,
        displayName: model.displayName,
        ...resolveVendorDraft(model.vendor),
        usageType: model.usageType,
        routingMode: model.routingMode,
        requiredTier: model.requiredTier,
        sortOrder: model.sortOrder,
        supportsReasoning: model.supportsReasoning,
        reasoningRequiredTier: model.reasoningRequiredTier,
        isReasoningDefault: model.isReasoningDefault,
        supportsVision: model.supportsVision,
        defaultTemperature: model.defaultTemperature,
        defaultTopP: model.defaultTopP,
        defaultPresencePenalty: model.defaultPresencePenalty,
        defaultFrequencyPenalty: model.defaultFrequencyPenalty,
        defaultMaxTokens: model.defaultMaxTokens,
        defaultReasoningEffort: model.defaultReasoningEffort,
        reasoningEffortFormat: model.reasoningEffortFormat,
        customParametersText: model.customParameters ? JSON.stringify(model.customParameters, null, 2) : '',
        description: model.description || '',
    };
}

export function createInitialSourceDraft(): SourceDraft {
    return {
        modelIdOverride: '',
        reasoningModelId: '',
        priority: 0,
        isEnabled: true,
        notes: '',
    };
}

export function normalizeSourceModelIdInput(modelIdOverride: string, modelKey: string): string | null {
    const normalizedOverride = modelIdOverride.trim();
    const normalizedModelKey = modelKey.trim();
    if (!normalizedOverride || normalizedOverride === normalizedModelKey) {
        return null;
    }
    return normalizedOverride;
}

export function getSourceModelIdState(modelKey: string, modelIdOverride: string | null) {
    const normalizedModelKey = modelKey.trim();
    const normalizedOverride = modelIdOverride?.trim();
    if (!normalizedOverride || normalizedOverride === normalizedModelKey) {
        return {
            value: normalizedModelKey,
            inherited: true,
        };
    }
    return {
        value: normalizedOverride,
        inherited: false,
    };
}

export function parseCustomParametersText(input: string): Record<string, unknown> | null {
    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('自定义参数必须是 JSON 对象');
    }
    return parsed as Record<string, unknown>;
}

export function buildCreateModelPayload(draft: CreateModelDraft) {
    return {
        modelKey: draft.modelKey.trim(),
        displayName: draft.displayName.trim(),
        vendor: resolveDraftVendor(draft),
        usageType: draft.usageType,
        routingMode: draft.routingMode,
        primaryGatewayKey: draft.primaryGatewayKey,
        requiredTier: draft.requiredTier,
        supportsReasoning: draft.supportsReasoning,
        reasoningRequiredTier: draft.reasoningRequiredTier,
        isReasoningDefault: draft.isReasoningDefault,
        supportsVision: draft.supportsVision,
        defaultTemperature: draft.defaultTemperature,
        defaultTopP: draft.defaultTopP,
        defaultPresencePenalty: draft.defaultPresencePenalty,
        defaultFrequencyPenalty: draft.defaultFrequencyPenalty,
        defaultMaxTokens: draft.defaultMaxTokens,
        defaultReasoningEffort: draft.supportsReasoning ? draft.defaultReasoningEffort : null,
        reasoningEffortFormat: draft.supportsReasoning ? draft.reasoningEffortFormat : null,
        customParameters: parseCustomParametersText(draft.customParametersText),
        description: draft.description.trim() || undefined,
    };
}

export function buildEditModelPayload(draft: EditModelDraft): Partial<AIModel> {
    return {
        modelKey: draft.modelKey.trim(),
        displayName: draft.displayName.trim(),
        vendor: resolveDraftVendor(draft),
        usageType: draft.usageType,
        routingMode: draft.routingMode,
        requiredTier: draft.requiredTier,
        sortOrder: draft.sortOrder,
        supportsReasoning: draft.supportsReasoning,
        reasoningRequiredTier: draft.reasoningRequiredTier,
        isReasoningDefault: draft.supportsReasoning ? draft.isReasoningDefault : false,
        supportsVision: draft.supportsVision,
        defaultTemperature: draft.defaultTemperature,
        defaultTopP: draft.defaultTopP,
        defaultPresencePenalty: draft.defaultPresencePenalty,
        defaultFrequencyPenalty: draft.defaultFrequencyPenalty,
        defaultMaxTokens: draft.defaultMaxTokens,
        defaultReasoningEffort: draft.supportsReasoning ? draft.defaultReasoningEffort : null,
        reasoningEffortFormat: draft.supportsReasoning ? draft.reasoningEffortFormat : null,
        customParameters: parseCustomParametersText(draft.customParametersText),
        description: draft.description.trim() || null,
    };
}

export function buildSourcePayload(draft: SourceDraft, modelKey: string) {
    return {
        modelIdOverride: normalizeSourceModelIdInput(draft.modelIdOverride, modelKey),
        reasoningModelId: draft.reasoningModelId.trim() || null,
        priority: draft.priority,
        isEnabled: draft.isEnabled,
        notes: draft.notes.trim() || null,
    };
}

export function createRoutingModeUpdate(draft: CreateModelDraft, routingMode: AIModel['routingMode']): Partial<CreateModelDraft> {
    return {
        routingMode,
        primaryGatewayKey: routingMode === 'newapi' || routingMode === 'octopus' ? routingMode : draft.primaryGatewayKey,
    };
}

export function createPrimaryGatewayUpdate(draft: CreateModelDraft, primaryGatewayKey: ManagedGatewayKey): Partial<CreateModelDraft> {
    return {
        primaryGatewayKey,
        routingMode: draft.routingMode === 'newapi' || draft.routingMode === 'octopus' ? primaryGatewayKey : draft.routingMode,
    };
}
