import 'server-only';
import { createHash } from 'node:crypto';
import type { AIModelConfig } from '@/types';
import { isPromptCacheEnabled } from './prompt-cache';

/** OpenAI takes at most 64 characters; the prefix and a 40-character digest stay well inside it. */
const KEY_PREFIX = 'taibu-';
const KEY_DIGEST_LENGTH = 40;

/**
 * The provider-facing cache key of a conversation: a truncated SHA-256 of the owner and the conversation. The upstream
 * learns only this stable, non-reversible value. The owner is part of the digest because the chat path takes its
 * conversation id from the browser: without it, a request naming somebody else's conversation id would land in that
 * member's cache partition. A caller without a known owner therefore gets no affinity at all.
 */
export function promptCacheKey(scope: string | null | undefined, conversationId: string | null | undefined): string | undefined {
    if (!scope || !conversationId) return undefined;
    return KEY_PREFIX + createHash('sha256').update(`${scope}:${conversationId}`).digest('hex').slice(0, KEY_DIGEST_LENGTH);
}

/** The key to send for this model: undefined when the switch is off or the owner or conversation is unknown. */
export function modelPromptCacheKey(
    config: Pick<AIModelConfig, 'customParameters'>,
    conversationId: string | null | undefined,
    scope: string | null | undefined,
): string | undefined {
    return isPromptCacheEnabled(config) ? promptCacheKey(scope, conversationId) : undefined;
}
