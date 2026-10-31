import {
    AI_REASONING_EFFORTS,
    type AIModelConfig,
    type AIReasoningEffort,
} from '@/types';

type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

/** The levels a model lists, in ladder order; unknown and repeated values drop out. */
export function normalizeThinkingLevels(value: unknown): AIReasoningEffort[] {
    if (!Array.isArray(value)) return [];
    return AI_REASONING_EFFORTS.filter(level => value.includes(level));
}

/**
 * The level a thinking request runs at. An unlisted level moves to the nearest listed one, upwards first, the way
 * pi-ai's clampThinkingLevel does. A model without levels never reaches a thinking request.
 */
export function resolveThinkingLevel(
    model: Pick<AIModelConfig, 'thinkingLevels' | 'defaultReasoningEffort'>,
    requested?: AIReasoningEffort | null,
): AIReasoningEffort {
    const levels = model.thinkingLevels ?? [];
    const wanted = requested ?? model.defaultReasoningEffort ?? 'medium';
    if (!levels.length || levels.includes(wanted)) return wanted;
    const index = AI_REASONING_EFFORTS.indexOf(wanted);
    return AI_REASONING_EFFORTS.slice(index).find(level => levels.includes(level))
        ?? AI_REASONING_EFFORTS.slice(0, index).reverse().find(level => levels.includes(level))
        ?? levels[0];
}

/** pi-ai's level map for a model: listed levels go out under their own names, the others are unsupported. */
export function thinkingLevelMap(levels: readonly AIReasoningEffort[] | undefined) {
    if (!levels?.length) return undefined;
    return Object.fromEntries(AI_REASONING_EFFORTS.map(level => [level, levels.includes(level) ? level : null])) as
        Record<AIReasoningEffort, AIReasoningEffort | null>;
}

/**
 * The body fields that switch thinking and set its level (`null` = off), written the way pi-ai's Chat Completions
 * transport writes them, so ordinary chat and the Agent ask a gateway for thinking in the same words. Only a model
 * that lists levels is sent one.
 */
export function thinkingRequestFields(
    model: Pick<AIModelConfig, 'supportsReasoning' | 'thinkingLevels'>,
    level: AIReasoningEffort | null,
): Record<string, JSONValue> {
    if (!model.supportsReasoning) return {};
    return level && model.thinkingLevels?.length ? { reasoning_effort: level } : {};
}

/** Body fields that carry thinking; a model's custom parameters cannot set them. */
export const THINKING_REQUEST_FIELDS: ReadonlySet<string> = new Set([
    'reasoning_effort', 'reasoningEffort', 'reasoning', 'enable_thinking', 'thinking', 'chat_template_kwargs',
]);
