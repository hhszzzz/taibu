import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AIModelConfig } from '../types';

const DEEPSEEK: AIModelConfig = {
    id: 'deepseek-v3.2', name: 'DeepSeek V3.2', vendor: 'deepseek', usageType: 'chat',
    modelId: 'deepseek-v3.2', apiUrl: '', supportsReasoning: false,
    pricing: { input: 0.27, output: 1.1, cacheRead: null, cacheWrite: null, image: null },
};
const UNPRICED: AIModelConfig = { ...DEEPSEEK, id: 'unpriced', modelId: 'unpriced', pricing: undefined };
const REASONER: AIModelConfig = { ...DEEPSEEK, id: 'reasoner', modelId: 'reasoner', supportsReasoning: true, supportsVision: true };

/** The catalog the access checks read, in place of the database. */
function catalog(t: TestContext, models: AIModelConfig[] = [DEEPSEEK, UNPRICED, REASONER]) {
    const config = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
    t.mock.method(config, 'getModelConfigAsync', async (id: string) => models.find(model => model.id === id));
}

test('resolveModelAccessAsync returns default model and disables reasoning', async (t) => {
    catalog(t);
    const { resolveModelAccessAsync } = await import('../lib/ai/ai-access');

    const result = await resolveModelAccessAsync(undefined, 'deepseek-v3.2', true);

    assert.equal('error' in result, false);
    if ('error' in result) return;
    assert.equal(result.modelId, 'deepseek-v3.2');
    assert.equal(result.reasoningEnabled, false);
});

test('resolveModelAccessAsync keeps reasoning for every member on a model that supports it', async (t) => {
    catalog(t);
    const { resolveModelAccessAsync } = await import('../lib/ai/ai-access');

    const result = await resolveModelAccessAsync('reasoner', 'deepseek-v3.2', true, { requireVision: true });

    assert.equal('error' in result, false);
    if ('error' in result) return;
    assert.equal(result.reasoningEnabled, true);
});

test('resolveModelAccessAsync rejects non-vision model when vision required', async (t) => {
    catalog(t);
    const { resolveModelAccessAsync } = await import('../lib/ai/ai-access');

    const result = await resolveModelAccessAsync(undefined, 'deepseek-v3.2', false, { requireVision: true });

    assert.equal('error' in result, true);
    if (!('error' in result)) return;
    assert.equal(result.status, 400);
});

test('resolveModelAccessAsync returns model unavailable for invalid id', async (t) => {
    catalog(t);
    const { resolveModelAccessAsync } = await import('../lib/ai/ai-access');

    const result = await resolveModelAccessAsync('invalid-model', 'deepseek-v3.2');

    assert.equal('error' in result, true);
    if (!('error' in result)) return;
    assert.equal(result.error, '模型不可用');
});

test('resolveModelAccessAsync refuses a model the administrator has not priced', async (t) => {
    catalog(t);
    const { resolveModelAccessAsync, UNPRICED_MODEL_MESSAGE } = await import('../lib/ai/ai-access');

    const result = await resolveModelAccessAsync('unpriced', 'deepseek-v3.2');

    assert.deepEqual(result, { error: UNPRICED_MODEL_MESSAGE, status: 403 });
});

test('isModelOffered prices text models per token and image models per image', async () => {
    const { isModelOffered } = await import('../lib/ai/ai-access');

    assert.equal(isModelOffered(DEEPSEEK), true);
    assert.equal(isModelOffered(UNPRICED), false);
    // All-zero token prices are a free model, still offered.
    assert.equal(isModelOffered({ ...DEEPSEEK, pricing: { input: 0, output: 0, cacheRead: null, cacheWrite: null, image: null } }), true);
    assert.equal(isModelOffered({ ...DEEPSEEK, usageType: 'image', pricing: { input: null, output: null, cacheRead: null, cacheWrite: null, image: 0.04 } }), true);
    assert.equal(isModelOffered({ ...DEEPSEEK, usageType: 'image' }), false);
});
