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

test('real SDK serialization forwards every listed level in the field its thinking format names', async () => {
    for (const effort of ALL_LEVELS) {
        const openai = await sentBody({ ...config, thinkingFormat: 'openai' }, { reasoning: true, reasoningEffort: effort });
        assert.equal(openai.reasoning_effort, effort);
        assert.equal(openai.model, 'fixture-model');
        assert.equal(openai.stream, true);
        assert.deepEqual((await sentBody({ ...config, thinkingFormat: 'openrouter' }, { reasoning: true, reasoningEffort: effort })).reasoning, { effort });
        const deepseek = await sentBody({ ...config, thinkingFormat: 'deepseek' }, { reasoning: true, reasoningEffort: effort });
        assert.deepEqual([deepseek.thinking, deepseek.reasoning_effort], [{ type: 'enabled' }, effort]);
    }
});

test('an unlisted level moves to the nearest listed one, and a model without levels only switches thinking', async () => {
    const ladder: AIModelConfig = { ...config, thinkingFormat: 'deepseek', thinkingLevels: ['low', 'high', 'max'], defaultReasoningEffort: 'high' };
    assert.equal((await sentBody(ladder, { reasoning: true, reasoningEffort: 'medium' })).reasoning_effort, 'high');
    assert.equal((await sentBody(ladder, { reasoning: true, reasoningEffort: 'xhigh' })).reasoning_effort, 'max');
    assert.equal((await sentBody(ladder, { reasoning: true })).reasoning_effort, 'high', 'no conversation level uses the model default');

    const toggle = await sentBody({ ...config, thinkingFormat: 'qwen', thinkingLevels: [] }, { reasoning: true, reasoningEffort: 'max' });
    assert.equal(toggle.enable_thinking, true);
    assert.equal(toggle.reasoning_effort, undefined);
    assert.deepEqual((await sentBody({ ...config, thinkingFormat: 'qwen-chat-template', thinkingLevels: [] }, { reasoning: true })).chat_template_kwargs, { enable_thinking: true, preserve_thinking: true });
    assert.deepEqual((await sentBody({ ...config, thinkingFormat: 'zai', thinkingLevels: [] }, { reasoning: true })).thinking, { type: 'enabled', clear_thinking: false });
});

test('provider extensions reuse the guarded fetch without replacing transcript, tools, output limits or thinking', async () => {
    const controller = new AbortController();
    const source: AIModelConfig = { ...config, thinkingFormat: 'deepseek', customParameters: {
        top_k: 20, repetition_penalty: 1.05,
        enable_thinking: true, chat_template_kwargs: { enable_thinking: true }, thinking: { type: 'enabled', budget_tokens: 1000 },
        messages: [{ role: 'system', content: 'must not replace' }], model: 'other-model', tools: [], stream: false,
        max_tokens: 999999, max_completion_tokens: 999999, maxCompletionTokens: 999999, maxTokens: 999999, maxOutputTokens: 999999,
    } };
    const body = await sentBody(source, { reasoning: true, reasoningEffort: 'high' }, { maxOutputTokens: 100, signal: controller.signal });
    assert.deepEqual([body.top_k, body.repetition_penalty], [20, 1.05]);
    // The thinking format writes the thinking fields; custom parameters cannot add or reshape them.
    assert.deepEqual([body.thinking, body.reasoning_effort], [{ type: 'enabled' }, 'high']);
    assert.equal(body.enable_thinking, undefined);
    assert.equal(body.chat_template_kwargs, undefined);
    assert.equal(body.model, 'fixture-model');
    assert.equal(body.stream, true);
    assert.match(JSON.stringify(body.messages), /原问题/);
    assert.doesNotMatch(JSON.stringify(body.messages), /must not replace/);
    assert.ok(body.max_tokens === 100 || body.max_completion_tokens === 100);
    assert.ok(!Object.values(body).includes(999999));
});

test('a conversation reasoning level overrides the model default and custom parameters in the real SDK request', async () => {
    const source: AIModelConfig = { ...config, thinkingFormat: 'openrouter', defaultReasoningEffort: 'low', customParameters: { reasoning: { effort: 'medium' }, reasoning_effort: 'low' } };
    const body = await sentBody(source, { reasoning: true, reasoningEffort: 'max' });
    assert.deepEqual(body.reasoning, { effort: 'max' });
    assert.equal(body.reasoning_effort, undefined);
});

test('turning thinking off sends each format its off switch and drops administrator thinking extensions', async () => {
    const customParameters = { reasoning_effort: 'max', reasoning: { effort: 'max' }, enable_thinking: true, chat_template_kwargs: { enable_thinking: true }, thinking: { type: 'enabled', budget_tokens: 1000 } };
    const off = (thinkingFormat: AIModelConfig['thinkingFormat']) => sentBody({ ...config, thinkingFormat, customParameters }, { reasoning: false });

    const deepseek = await off('deepseek');
    assert.deepEqual(deepseek.thinking, { type: 'disabled' });
    assert.deepEqual([deepseek.reasoning_effort, deepseek.reasoning, deepseek.enable_thinking, deepseek.chat_template_kwargs], [undefined, undefined, undefined, undefined]);
    assert.equal((await off('qwen')).enable_thinking, false);
    assert.deepEqual((await off('qwen-chat-template')).chat_template_kwargs, { enable_thinking: false, preserve_thinking: true });
    assert.deepEqual((await off('zai')).thinking, { type: 'disabled' });
    assert.deepEqual((await off('openrouter')).reasoning, { effort: 'none' });
    const openai = await off('openai');
    assert.deepEqual([openai.reasoning_effort, openai.reasoning, openai.thinking], [undefined, undefined, undefined]);

    // A model that does not think is never sent thinking fields, even when the conversation asks.
    const plain = await sentBody({ ...config, supportsReasoning: false, thinkingFormat: 'deepseek', customParameters }, { reasoning: true, reasoningEffort: 'high' });
    assert.deepEqual([plain.thinking, plain.reasoning_effort, plain.enable_thinking], [undefined, undefined, undefined]);
});
