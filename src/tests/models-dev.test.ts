import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultThinkingLevel,
  exactModelsDevMatch,
  flattenModelsDevCatalog,
  matchModelsDevModels,
  modelsDevSuggestion,
  planModelsDevFill,
  type ModelsDevCatalog,
} from '../lib/admin/models-dev';
import type { AdminModelInput } from '../lib/admin/ai-catalog';

const catalog: ModelsDevCatalog = {
  deepseek: {
    name: 'DeepSeek',
    models: {
      'deepseek-v4-flash': {
        id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: true,
        reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high', 'max'] }],
        modalities: { input: ['text', 'image'] },
        limit: { context: 1_000_000, output: 128_000 },
        cost: { input: 0.27, output: 1.1, cache_read: 0.07 },
      },
      'deepseek-chat': {
        id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: false,
        modalities: { input: ['text'] }, limit: { context: 128_000, output: 8_000 },
        cost: { input: 0.14, output: 0.28 },
      },
      'no-limits': { id: 'no-limits', name: 'No Limits' },
      'only-prices': { id: 'only-prices', name: 'Only Prices', cost: { input: 1.23456, output: 2 } },
      'bad-prices': { id: 'bad-prices', name: 'Bad Prices', cost: { input: 20_000, output: -1 } },
    },
  },
  openrouter: {
    name: 'OpenRouter',
    models: {
      'deepseek/deepseek-v4-flash': {
        id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: true,
        canonical_model_id: 'deepseek/deepseek-v4-flash',
        limit: { context: 1_000_000, output: 128_000 },
        cost: { input: 0.29, output: 1.2 },
      },
    },
  },
};

function model(overrides: Partial<AdminModelInput> = {}): AdminModelInput {
  return {
    modelKey: 'fixture', displayName: 'Fixture', description: '', vendor: 'other', icon: null, usageType: 'chat',
    pricing: { input: null, output: null, cacheRead: null, cacheWrite: null, image: null },
    isEnabled: true, sortOrder: 0, supportsVision: false, isReasoningDefault: false,
    thinkingLevels: [], defaultReasoningEffort: null, contextWindow: null, defaultMaxTokens: null,
    customParameters: null, sources: [],
    ...overrides,
  };
}

test('models.dev records become catalog suggestions with limits, thinking levels, vision and pricing', () => {
  const models = flattenModelsDevCatalog(catalog);
  assert.equal(models.length, 4, 'records without limits or prices are dropped');
  const flash = models.find(entry => entry.id === 'deepseek-v4-flash');
  assert.ok(flash);
  assert.equal(flash.contextWindow, 1_000_000);
  assert.equal(flash.maxTokens, 128_000);
  assert.equal(flash.reasoning, true);
  assert.deepEqual(flash.thinkingLevels, ['low', 'high', 'max']);
  assert.equal(flash.vision, true);
  assert.deepEqual(flash.pricing, { input: 0.27, output: 1.1, cacheRead: 0.07 });
  const chat = models.find(entry => entry.id === 'deepseek-chat');
  assert.deepEqual(chat?.thinkingLevels, []);
  assert.equal(chat?.vision, false);
  assert.deepEqual(chat?.pricing, { input: 0.14, output: 0.28 });
  const onlyPrices = models.find(entry => entry.id === 'only-prices');
  assert.equal(onlyPrices?.contextWindow, undefined);
  assert.deepEqual(onlyPrices?.pricing, { input: 1.2346, output: 2 }, 'prices round to four decimals');
  assert.equal(models.some(entry => entry.id === 'bad-prices'), false, 'out-of-range prices alone are not a suggestion');
  assert.equal(modelsDevSuggestion('x', 'X', 'empty', { id: 'empty' }), null);
});

test('a canonical id is carried for dealer entries', () => {
  const models = flattenModelsDevCatalog(catalog);
  const openrouter = models.find(entry => entry.provider === 'openrouter');
  assert.equal(openrouter?.canonicalId, 'deepseek/deepseek-v4-flash');
});

test('matching prefers an exact id, then the canonical provider', () => {
  const models = flattenModelsDevCatalog(catalog);
  const [first] = matchModelsDevModels(models, 'deepseek-v4-flash');
  assert.equal(first.provider, 'deepseek');
  assert.equal(first.id, 'deepseek-v4-flash');

  const prefixed = matchModelsDevModels(models, 'deepseek/deepseek-v4-flash');
  assert.equal(prefixed[0].provider, 'deepseek', 'the canonical provider lists first');
  assert.ok(prefixed.some(entry => entry.id === 'deepseek/deepseek-v4-flash'), 'gateway-style ids still match');

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

test('exact lookups accept identical ids, canonical ids and names, but never prefixes or substrings', () => {
  const models: ModelsDevCatalog = {
    openai: { name: 'OpenAI', models: {
      'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', limit: { context: 128_000, output: 16_384 } },
      'gpt-4o-mini': { id: 'gpt-4o-mini', name: 'GPT-4o mini', limit: { context: 128_000, output: 16_384 } },
    } },
    gateway: { name: 'Gateway', models: {
      'openai/gpt-4o': { id: 'openai/gpt-4o', name: 'GPT-4o via gateway', canonical_model_id: 'openai/gpt-4o', limit: { context: 128_000 } },
    } },
    zzz: { name: 'Z', models: {
      gpt4o: { id: 'gpt4o', name: 'GPT 4o', limit: { context: 64_000 } },
    } },
  };
  const flattened = flattenModelsDevCatalog(models);
  assert.equal(exactModelsDevMatch(flattened, ['gpt-4o'])?.provider, 'openai');
  assert.equal(exactModelsDevMatch(flattened, ['GPT-4o'])?.id, 'gpt-4o', 'a display name matches at tier one');
  assert.equal(exactModelsDevMatch(flattened, ['gpt-4o-mini-2024-07-18']), null, 'a prefix never matches a different model');
  assert.equal(exactModelsDevMatch(flattened, ['gpt']), null);
  assert.equal(exactModelsDevMatch(flattened, []), null);
  assert.equal(exactModelsDevMatch(flattened, ['  ']), null);

  const canonical = flattenModelsDevCatalog({
    gateway: { name: 'Gateway', models: {
      alias: { id: 'alias', name: 'Alias', canonical_model_id: 'acme/unique-model', limit: { context: 1000 } },
    } },
  });
  assert.equal(exactModelsDevMatch(canonical, ['unique-model'])?.id, 'alias', 'a canonical id matches without a prefix');
});

test('exact lookups prefer the id over a name, then the mainstream provider', () => {
  const models: ModelsDevCatalog = {
    alpha: { name: 'Alpha', models: {
      shared: { id: 'shared', name: 'Shared Name', limit: { context: 1000 } },
    } },
    openai: { name: 'OpenAI', models: {
      other: { id: 'other', name: 'shared', limit: { context: 1000 } },
    } },
  };
  const flattened = flattenModelsDevCatalog(models);
  assert.equal(exactModelsDevMatch(flattened, ['shared'])?.provider, 'alpha', 'an id match outranks a name match');

  const tied = flattenModelsDevCatalog({
    zeta: { name: 'Zeta', models: { shared: { id: 'shared', name: 'Shared', limit: { context: 1000 } } } },
    openai: { name: 'OpenAI', models: { shared: { id: 'shared', name: 'Shared', limit: { context: 2000 } } } },
  });
  assert.equal(exactModelsDevMatch(tied, ['shared'])?.provider, 'openai', 'the mainstream provider wins a tie');
});

test('the default thinking level is medium, otherwise the highest listed level', () => {
  assert.equal(defaultThinkingLevel(['low', 'medium', 'high']), 'medium');
  assert.equal(defaultThinkingLevel(['low', 'high']), 'high');
  assert.equal(defaultThinkingLevel(['max']), 'max');
  assert.equal(defaultThinkingLevel([]), null);
});

test('plan filling only fills blanks on chat models and labels every change', () => {
  const suggestion = modelsDevSuggestion('deepseek', 'DeepSeek', 'deepseek-v4-flash', {
    id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: true,
    reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
    modalities: { input: ['text', 'image'] }, limit: { context: 200_000, output: 64_000 },
    cost: { input: 0.27, output: 1.1, cache_read: 0.07 },
  });
  assert.ok(suggestion);

  const filled = planModelsDevFill(model(), suggestion);
  assert.deepEqual(filled.changes, ['上下文', '输出上限', '思考等级', '输入价', '输出价', '缓存读价']);
  assert.equal(filled.input.contextWindow, 200_000);
  assert.equal(filled.input.defaultMaxTokens, 64_000);
  assert.deepEqual(filled.input.thinkingLevels, ['low', 'medium', 'high']);
  assert.equal(filled.input.defaultReasoningEffort, 'medium');
  assert.equal(filled.input.supportsVision, false, 'image input is a model setting, never filled in');
  assert.deepEqual(filled.input.pricing, { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: null, image: null });
  assert.equal(filled.input.displayName, 'Fixture', 'names and sources stay untouched');
  assert.equal(filled.input.icon, null);

  const partiallyFilled = planModelsDevFill(model({
    contextWindow: 128_000, defaultMaxTokens: 64_000, thinkingLevels: ['low'], supportsVision: true,
    pricing: { input: 0, output: null, cacheRead: null, cacheWrite: null, image: null },
  }), suggestion);
  assert.deepEqual(partiallyFilled.changes, ['输出价', '缓存读价']);
  assert.equal(partiallyFilled.input.pricing.input, 0, 'a filled zero price is left alone');
});

test('plan filling rejects invalid catalog values and never prices an all-zero model', () => {
  const tooLarge = modelsDevSuggestion('p', 'P', 'x', {
    id: 'x', name: 'X', limit: { context: 20_000_000, output: 2_000_000 }, cost: { input: 0, output: 0 },
  });
  assert.ok(tooLarge);
  assert.deepEqual(planModelsDevFill(model(), tooLarge).changes, [], 'context and output stay within their bounds');

  const free = modelsDevSuggestion('p', 'P', 'free', { id: 'free', name: 'Free', limit: { context: 2048 }, cost: { input: 0, output: 0 } });
  assert.ok(free);
  const filled = planModelsDevFill(model(), free);
  assert.deepEqual(filled.changes, ['上下文']);
  assert.equal(filled.input.pricing.input, null, 'a zero-priced dealer entry is not a platform price');

  const contextFirst = modelsDevSuggestion('p', 'P', 'ctx', { id: 'ctx', name: 'Ctx', limit: { context: 32_000, output: 64_000 } });
  assert.ok(contextFirst);
  assert.equal(planModelsDevFill(model(), contextFirst).input.defaultMaxTokens, null, 'output must stay below the context window');
});

test('plan filling leaves non-chat models and their prices alone', () => {
  const suggestion = modelsDevSuggestion('p', 'P', 'img', {
    id: 'img', name: 'Image', limit: { context: 1000 }, cost: { input: 1, output: 2 },
  });
  assert.ok(suggestion);
  const image = model({ usageType: 'image', pricing: { input: null, output: null, cacheRead: null, cacheWrite: null, image: 0.02 } });
  const result = planModelsDevFill(image, suggestion);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.input.pricing, image.pricing);
});
