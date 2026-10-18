import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchModelVendor } from '../lib/ai/vendor-match';

test('vendor prefix match recognises common model ids', () => {
    assert.equal(matchModelVendor('deepseek-chat'), 'deepseek');
    assert.equal(matchModelVendor('claude-sonnet-4-5'), 'anthropic');
    assert.equal(matchModelVendor('gpt-4.1-mini'), 'openai');
    assert.equal(matchModelVendor('o3-mini'), 'openai');
    assert.equal(matchModelVendor('gemini-2.5-pro'), 'gemini');
    assert.equal(matchModelVendor('glm-4.6'), 'glm');
    assert.equal(matchModelVendor('kimi-k2-turbo-preview'), 'moonshot');
    assert.equal(matchModelVendor('qwen3-max'), 'qwen');
    assert.equal(matchModelVendor('grok-4'), 'xai');
    assert.equal(matchModelVendor('MiniMax-M2'), 'minimax');
});

test('vendor prefix match is case-insensitive and trims whitespace', () => {
    assert.equal(matchModelVendor('  DeepSeek-Chat '), 'deepseek');
    assert.equal(matchModelVendor('CLAUDE-OPUS-4-1'), 'anthropic');
});

test('vendor prefix match falls back to segments around gateway prefixes', () => {
    // OpenRouter 风格：`vendor/model` 与多级路径都按 `/` 分段命中。
    assert.equal(matchModelVendor('anthropic/claude-sonnet-4-5'), 'anthropic');
    assert.equal(matchModelVendor('openrouter/anthropic/claude-3-7-sonnet'), 'anthropic');
    assert.equal(matchModelVendor('deepseek/deepseek-chat-v3'), 'deepseek');
});

test('vendor prefix match returns null for unknown or empty ids', () => {
    assert.equal(matchModelVendor('my-private-model'), null);
    assert.equal(matchModelVendor(''), null);
    assert.equal(matchModelVendor('   '), null);
});
