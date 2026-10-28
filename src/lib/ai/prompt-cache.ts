/**
 * Prompt-cache affinity, shared by the AI SDK chat path, the Agent stream and the admin catalog.
 *
 * A provider that understands `prompt_cache_key` routes requests carrying the same key to the same
 * prompt cache. The switch lives in a model's `custom_parameters`, is off by default, and is never
 * forwarded to an upstream as a request field of its own: gateways that reject the key never see it.
 */
import type { AIModelConfig } from '@/types';

/** Reserved `custom_parameters` entry: `true` enables the affinity for this model, anything else leaves it off. */
export const PROMPT_CACHE_SWITCH = 'promptCacheKey';

/** Whether the model has prompt-cache affinity switched on. */
export function isPromptCacheEnabled(config: Pick<AIModelConfig, 'customParameters'>): boolean {
    return config.customParameters?.[PROMPT_CACHE_SWITCH] === true;
}
