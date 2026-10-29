import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenModelsDevCatalog,
  matchModelsDevModels,
  modelsDevSuggestion,
  type ModelsDevCatalog,
} from '../lib/admin/models-dev';

const catalog: ModelsDevCatalog = {
  deepseek: {
    name: 'DeepSeek',
    models: {
      'deepseek-v4-flash': {
        id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: true,
        reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high', 'max'] }],
        modalities: { input: ['text', 'image'] },
        limit: { context: 1_000_000, output: 128_000 },
      },
      'deepseek-chat': {
        id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: false,
        modalities: { input: ['text'] }, limit: { context: 128_000, output: 8_000 },
      },
      'no-limits': { id: 'no-limits', name: 'No Limits' },
    },
  },
  openrouter: {
    name: 'OpenRouter',
    models: {
      'deepseek/deepseek-v4-flash': {
        id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: true,
        limit: { context: 1_000_000, output: 128_000 },
      },
    },
  },
};

test('models.dev records become catalog suggestions with thinking levels and vision', () => {
  const models = flattenModelsDevCatalog(catalog);
  assert.equal(models.length, 3, 'records without limits are dropped');
  const flash = models.find(model => model.id === 'deepseek-v4-flash');
  assert.ok(flash);
  assert.equal(flash.contextWindow, 1_000_000);
  assert.equal(flash.maxTokens, 128_000);
  assert.equal(flash.reasoning, true);
  assert.deepEqual(flash.thinkingLevels, ['low', 'high', 'max']);
  assert.equal(flash.vision, true);
  const chat = models.find(model => model.id === 'deepseek-chat');
  assert.deepEqual(chat?.thinkingLevels, []);
  assert.equal(chat?.vision, false);
  assert.equal(modelsDevSuggestion('x', 'X', 'empty', { id: 'empty' }), null);
});

test('matching prefers an exact id, then the canonical provider', () => {
  const models = flattenModelsDevCatalog(catalog);
  const [first] = matchModelsDevModels(models, 'deepseek-v4-flash');
  assert.equal(first.provider, 'deepseek');
  assert.equal(first.id, 'deepseek-v4-flash');

  const prefixed = matchModelsDevModels(models, 'deepseek/deepseek-v4-flash');
  assert.equal(prefixed[0].provider, 'deepseek', 'the canonical provider lists first');
  assert.ok(prefixed.some(model => model.id === 'deepseek/deepseek-v4-flash'), 'gateway-style ids still match');

  assert.deepEqual(matchModelsDevModels(models, '   '), []);
  assert.deepEqual(matchModelsDevModels(models, 'nothing-like-this'), []);
});

test('matching is case and separator insensitive', () => {
  const models = flattenModelsDevCatalog(catalog);
  assert.equal(matchModelsDevModels(models, 'DeepSeek V4 Flash')[0].id, 'deepseek-v4-flash');
  assert.equal(matchModelsDevModels(models, 'deepseek_chat')[0].id, 'deepseek-chat');
});

test('the match list is bounded', () => {
  const many: ModelsDevCatalog = {
    p: { name: 'P', models: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [
      `model-${index}`, { id: `model-${index}`, name: `Model ${index}`, limit: { context: 1000, output: 100 } },
    ])) },
  };
  assert.equal(matchModelsDevModels(flattenModelsDevCatalog(many), 'model').length, 20);
  assert.equal(matchModelsDevModels(flattenModelsDevCatalog(many), 'model', 5).length, 5);
});
