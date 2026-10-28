import 'server-only';
import { createHash } from 'node:crypto';
import type { AIModelConfig } from '@/types';
import { isPromptCacheEnabled } from './prompt-cache';

/** OpenAI takes at most 64 characters; the prefix and a 40-character digest stay well inside it. */
const KEY_PREFIX = 'taibu-';
const KEY_DIGEST_LENGTH = 40;

/**
 * The provider-facing cache key of a conversation: a truncated SHA-256 of its id. The upstream learns
 * only this stable, non-reversible value, never the conversation id itself.
 */
export function promptCacheKey(conversationId: string | null | undefined): string | undefined {
    if (!conversationId) return undefined;
    return KEY_PREFIX + createHash('sha256').update(conversationId).digest('hex').slice(0, KEY_DIGEST_LENGTH);
}

/** The key to send for this model: undefined when the switch is off or the conversation is unknown. */
export function modelPromptCacheKey(
    config: Pick<AIModelConfig, 'customParameters'>,
    conversationId: string | null | undefined,
): string | undefined {
    return isPromptCacheEnabled(config) ? promptCacheKey(conversationId) : undefined;
}
