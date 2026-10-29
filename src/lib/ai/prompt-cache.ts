/**
 * Prompt-cache affinity, shared by the AI SDK chat path, the Agent stream and the admin catalog.
 *
 * A provider that understands `prompt_cache_key` routes requests carrying the same key to the same
 * prompt cache. Affinity is on by default; a model that cannot take the field opts out with
 * `{"promptCacheKey": false}` in `custom_parameters`. The switch itself is never forwarded upstream.
 */
import type { AIModelConfig } from '@/types';

/** Reserved `custom_parameters` entry: only an explicit `false` turns the affinity off for this model. */
export const PROMPT_CACHE_SWITCH = 'promptCacheKey';

/** Prompt-cache affinity is on unless the model explicitly opts out. */
export function isPromptCacheEnabled(config: Pick<AIModelConfig, 'customParameters'>): boolean {
    return config.customParameters?.[PROMPT_CACHE_SWITCH] !== false;
}
