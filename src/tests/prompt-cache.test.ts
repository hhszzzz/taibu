import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamText } from 'ai';
import { buildProviderOptions, createModelFromConfig } from '../lib/ai/providers/ai-sdk-provider';
import { promptCacheKey } from '../lib/ai/prompt-cache.server';
import type { AIModelConfig } from '../types';

const STREAM = 'data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"fixture-model","choices":[{"index":0,"delta":{"content":"回答"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"fixture-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

const config = (customParameters?: Record<string, unknown>): AIModelConfig => ({
    id: 'fixture', name: 'fixture', vendor: 'other', modelId: 'fixture-model', apiUrl: 'https://fixture.example/v1',
    supportsReasoning: false, ...(customParameters ? { customParameters } : {}),
});

/** Sends one real AI SDK request and returns the body the gateway received. */
async function sentBody(source: AIModelConfig, conversationId?: string, cacheScope = 'member-a') {
    let body: Record<string, unknown> | undefined;
    const model = createModelFromConfig(source, { apiKey: 'fixture-only', fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(STREAM, { headers: { 'Content-Type': 'text/event-stream' } });
    } });
    const result = streamText({ model, prompt: '原问题', maxRetries: 0, providerOptions: buildProviderOptions(source, { conversationId, cacheScope }) });
    assert.equal(await result.text, '回答');
    assert.ok(body);
    return body;
}

test('the provider option appears only for a model that opts in and a request that names its owner and conversation', () => {
    const enabled = config({ promptCacheKey: true });
    const key = promptCacheKey('member-a', 'conversation-a');
    assert.ok(key);
    assert.deepEqual(buildProviderOptions(enabled, { conversationId: 'conversation-a', cacheScope: 'member-a' }), { openai: { promptCacheKey: key } });

    assert.equal(buildProviderOptions(config(), { conversationId: 'conversation-a', cacheScope: 'member-a' }), undefined, 'off by default');
    assert.equal(buildProviderOptions(config({ promptCacheKey: false }), { conversationId: 'conversation-a', cacheScope: 'member-a' }), undefined, 'an explicit false stays off');
    assert.equal(buildProviderOptions(config({ promptCacheKey: 'yes' }), { conversationId: 'conversation-a', cacheScope: 'member-a' }), undefined, 'only true enables it');
    assert.equal(buildProviderOptions(enabled, {}), undefined, 'a request without a conversation has no affinity');
    assert.equal(buildProviderOptions(enabled, { conversationId: 'conversation-a' }), undefined, 'nor without an owner');
});

test('the cache key is stable within one member and conversation, and differs across both', () => {
    const first = promptCacheKey('member-a', 'conversation-a');
    assert.equal(first, promptCacheKey('member-a', 'conversation-a'));
    assert.notEqual(first, promptCacheKey('member-a', 'conversation-b'));
    assert.notEqual(first, promptCacheKey('member-b', 'conversation-a'), 'two members never share a cache partition');
    assert.ok(first && !first.includes('conversation-a') && !first.includes('member-a'), 'neither the conversation id nor the member id reaches the upstream');
    assert.ok((first?.length ?? 0) <= 64, 'OpenAI accepts at most 64 characters');
    assert.equal(promptCacheKey(undefined, 'conversation-a'), undefined);
    assert.equal(promptCacheKey('member-a', undefined), undefined);
    assert.equal(promptCacheKey('', ''), undefined);
});

test('a real SDK request sends prompt_cache_key only when enabled, and never the switch itself', async () => {
    const enabled = await sentBody(config({ promptCacheKey: true, top_k: 20 }), 'conversation-a');
    assert.equal(enabled.prompt_cache_key, promptCacheKey('member-a', 'conversation-a'));
    assert.equal(enabled.promptCacheKey, undefined);
    assert.equal(enabled.top_k, 20, 'other custom parameters still reach the gateway');

    const disabled = await sentBody(config({ promptCacheKey: true }), undefined);
    assert.equal(disabled.prompt_cache_key, undefined);
    assert.equal(disabled.promptCacheKey, undefined);

    const off = await sentBody(config({ promptCacheKey: false }), 'conversation-a');
    assert.equal(off.prompt_cache_key, undefined);
    assert.equal(off.promptCacheKey, undefined, 'the reserved switch is not a request field');
});
