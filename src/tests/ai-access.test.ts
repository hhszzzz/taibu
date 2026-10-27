import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AIModelConfig } from '../types';

const DEEPSEEK: AIModelConfig = {
    id: 'deepseek-v3.2', name: 'DeepSeek V3.2', vendor: 'deepseek', usageType: 'chat',
    modelId: 'deepseek-v3.2', apiUrl: '', supportsReasoning: false, requiredTier: 'free',
};

/** The catalog the access checks read, in place of the database. */
function catalog(t: TestContext, models: AIModelConfig[] = [DEEPSEEK]) {
    const config = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
    t.mock.method(config, 'getModelConfigAsync', async (id: string) => models.find(model => model.id === id));
}

test('resolveModelAccessAsync returns default model and disables reasoning', async (t) => {
    catalog(t);
    const { resolveModelAccessAsync } = await import('../lib/ai/ai-access');

    const result = await resolveModelAccessAsync(undefined, 'deepseek-v3.2', 'free', true);

    assert.equal('error' in result, false);
    if ('error' in result) return;
    assert.equal(result.modelId, 'deepseek-v3.2');
    assert.equal(result.reasoningEnabled, false);
});

test('resolveModelAccessAsync rejects non-vision model when vision required', async (t) => {
    catalog(t);
    const { resolveModelAccessAsync } = await import('../lib/ai/ai-access');

    const result = await resolveModelAccessAsync(undefined, 'deepseek-v3.2', 'plus', false, { requireVision: true });

    assert.equal('error' in result, true);
    if (!('error' in result)) return;
    assert.equal(result.status, 400);
});

test('resolveModelAccessAsync returns model unavailable for invalid id', async (t) => {
    catalog(t);
    const { resolveModelAccessAsync } = await import('../lib/ai/ai-access');

    const result = await resolveModelAccessAsync('invalid-model', 'deepseek-v3.2', 'plus');

    assert.equal('error' in result, true);
    if (!('error' in result)) return;
    assert.equal(result.error, '模型不可用');
});
