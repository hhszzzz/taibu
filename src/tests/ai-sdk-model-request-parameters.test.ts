import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamText } from 'ai';
import { buildProviderOptions, createModelFromConfig } from '../lib/ai/providers/ai-sdk-provider';
import type { AIModelConfig, AIReasoningEffort } from '../types';

const ALL_LEVELS: AIReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const config: AIModelConfig = { id: 'fixture', name: 'fixture', vendor: 'other', modelId: 'fixture-model', apiUrl: 'https://fixture.example/v1', supportsReasoning: true, thinkingLevels: ALL_LEVELS };
const STREAM = 'data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"fixture-model","choices":[{"index":0,"delta":{"content":"回答"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"fixture-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

/** Sends one real AI SDK request for the model and returns the body the gateway received. */
async function sentBody(source: AIModelConfig, options: { reasoning: boolean; reasoningEffort?: AIReasoningEffort }, extra: { maxOutputTokens?: number; signal?: AbortSignal } = {}) {
    let body: Record<string, unknown> | undefined;
    const model = createModelFromConfig(source, { ...options, apiKey: 'fixture-only', fetch: async (_input, init) => {
        if (extra.signal) assert.ok(init?.signal);
        body = JSON.parse(String(init?.body));
        return new Response(STREAM, { headers: { 'Content-Type': 'text/event-stream' } });
    } });
    const result = streamText({ model, prompt: '原问题', maxRetries: 0, maxOutputTokens: extra.maxOutputTokens, abortSignal: extra.signal, providerOptions: buildProviderOptions(source, options) });
    assert.equal(await result.text, '回答');
    assert.ok(body);
    return body;
}

test('real SDK serialization forwards every listed level as reasoning_effort', async () => {
    for (const effort of ALL_LEVELS) {
        const body = await sentBody(config, { reasoning: true, reasoningEffort: effort });
        assert.equal(body.reasoning_effort, effort);
        assert.equal(body.model, 'fixture-model');
        assert.equal(body.stream, true);
    }
});

test('an unlisted level moves to the nearest listed one, and a model without levels sends no thinking field', async () => {
    const ladder: AIModelConfig = { ...config, thinkingLevels: ['low', 'high', 'max'], defaultReasoningEffort: 'high' };
    assert.equal((await sentBody(ladder, { reasoning: true, reasoningEffort: 'medium' })).reasoning_effort, 'high');
    assert.equal((await sentBody(ladder, { reasoning: true, reasoningEffort: 'xhigh' })).reasoning_effort, 'max');
    assert.equal((await sentBody(ladder, { reasoning: true })).reasoning_effort, 'high', 'no conversation level uses the model default');

    const none = await sentBody({ ...config, thinkingLevels: [] }, { reasoning: true, reasoningEffort: 'max' });
    assert.equal(none.reasoning_effort, undefined);
});

test('provider extensions reuse the guarded fetch without replacing transcript, tools, output limits or thinking', async () => {
    const controller = new AbortController();
    const source: AIModelConfig = { ...config, customParameters: {
        top_k: 20, repetition_penalty: 1.05,
        enable_thinking: true, chat_template_kwargs: { enable_thinking: true }, thinking: { type: 'enabled', budget_tokens: 1000 },
        messages: [{ role: 'system', content: 'must not replace' }], model: 'other-model', tools: [], stream: false,
        max_tokens: 999999, max_completion_tokens: 999999, maxCompletionTokens: 999999, maxTokens: 999999, maxOutputTokens: 999999,
    } };
    const body = await sentBody(source, { reasoning: true, reasoningEffort: 'high' }, { maxOutputTokens: 100, signal: controller.signal });
    assert.deepEqual([body.top_k, body.repetition_penalty], [20, 1.05]);
    // Thinking fields are system-owned; custom parameters cannot add or reshape them.
    assert.equal(body.reasoning_effort, 'high');
    assert.equal(body.enable_thinking, undefined);
    assert.equal(body.chat_template_kwargs, undefined);
    assert.equal(body.thinking, undefined);
    assert.equal(body.model, 'fixture-model');
    assert.equal(body.stream, true);
    assert.match(JSON.stringify(body.messages), /原问题/);
    assert.doesNotMatch(JSON.stringify(body.messages), /must not replace/);
    assert.ok(body.max_tokens === 100 || body.max_completion_tokens === 100);
    assert.ok(!Object.values(body).includes(999999));
});

test('a conversation reasoning level overrides the model default and custom thinking parameters', async () => {
    const source: AIModelConfig = { ...config, defaultReasoningEffort: 'low', customParameters: { reasoning: { effort: 'medium' }, reasoning_effort: 'low' } };
    const body = await sentBody(source, { reasoning: true, reasoningEffort: 'max' });
    assert.equal(body.reasoning_effort, 'max');
    assert.equal(body.reasoning, undefined);
});

test('turning thinking off omits every thinking field and drops administrator thinking extensions', async () => {
    const customParameters = { reasoning_effort: 'max', reasoning: { effort: 'max' }, enable_thinking: true, chat_template_kwargs: { enable_thinking: true }, thinking: { type: 'enabled', budget_tokens: 1000 } };
    const off = await sentBody({ ...config, customParameters }, { reasoning: false });
    assert.deepEqual([off.reasoning_effort, off.reasoning, off.enable_thinking, off.chat_template_kwargs, off.thinking], [undefined, undefined, undefined, undefined, undefined]);

    // A model that does not think is never sent thinking fields, even when the conversation asks.
    const plain = await sentBody({ ...config, supportsReasoning: false, customParameters }, { reasoning: true, reasoningEffort: 'high' });
    assert.deepEqual([plain.reasoning_effort, plain.enable_thinking], [undefined, undefined]);
});
