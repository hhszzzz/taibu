import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOrderedModelSources } from '../lib/ai/source-runtime';
import type { AIModelConfig, AIModelSourceConfig } from '../types';
import { sealedGateway } from './helpers/gateway-key';

const NEWAPI_KEY = sealedGateway('gateway-newapi', 'newapi-key');
const OCTOPUS_KEY = sealedGateway('gateway-octopus', 'octopus-key');

test('callAI should fall back from primary source to backup source', async (t) => {
  const aiModule = require('../lib/ai/ai') as any;
  const serverConfigModule = require('../lib/server/ai-config') as any;

  const originalGetModelConfigAsync = serverConfigModule.getModelConfigAsync;
  const originalFetch = global.fetch;

  const urls: string[] = [];

  serverConfigModule.getModelConfigAsync = async () => ({
    id: 'deepseek-v3.2',
    name: 'DeepSeek V3.2',
    vendor: 'deepseek',
    usageType: 'chat',
    modelId: 'deepseek-v3.2',
    apiUrl: 'https://newapi.example/v1/chat/completions',
    sourceKey: 'newapi',
    supportsReasoning: false,
    defaultMaxTokens: 4000,
    sources: [
      {
        sourceKey: 'newapi',
        sourceName: 'NewAPI',
        apiUrl: 'https://newapi.example/v1/chat/completions',
        ...NEWAPI_KEY,
        modelIdOverride: 'deepseek-v3.2',
        priority: 1,
        isActive: true,
        isEnabled: true,
      },
      {
        sourceKey: 'octopus',
        sourceName: 'Octopus',
        apiUrl: 'https://octopus.example/v1/chat/completions',
        ...OCTOPUS_KEY,
        modelIdOverride: 'deepseek-v3.2',
        priority: 2,
        isActive: false,
        isEnabled: true,
      },
    ],
  });

  global.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    if (String(input).includes('newapi')) {
      return new Response('upstream failure', { status: 502 });
    }
    return Response.json({
      choices: [{ index: 0, message: { content: 'backup-success' } }],
    });
  }) as typeof fetch;

  t.after(() => {
    serverConfigModule.getModelConfigAsync = originalGetModelConfigAsync;
    global.fetch = originalFetch;
  });

  const result = await aiModule.callAI(
    [{ role: 'user', content: 'hello' }],
    'deepseek-v3.2',
    '',
  );

  assert.equal(result, 'backup-success');
  assert.deepEqual(urls, [
    'https://newapi.example/v1/chat/completions',
    'https://octopus.example/v1/chat/completions',
  ]);
});

test('callAI skips a source whose gateway has no saved key', async (t) => {
  const aiModule = require('../lib/ai/ai') as any;
  const serverConfigModule = require('../lib/server/ai-config') as any;

  const originalGetModelConfigAsync = serverConfigModule.getModelConfigAsync;
  const originalFetch = global.fetch;

  const urls: string[] = [];

  serverConfigModule.getModelConfigAsync = async () => ({
    id: 'deepseek-v3.2',
    name: 'DeepSeek V3.2',
    vendor: 'deepseek',
    usageType: 'chat',
    modelId: 'deepseek-v3.2',
    apiUrl: 'https://newapi.example/v1/chat/completions',
    sourceKey: 'newapi',
    supportsReasoning: false,
    defaultMaxTokens: 4000,
    sources: [
      {
        sourceKey: 'newapi',
        sourceName: 'NewAPI',
        apiUrl: 'https://newapi.example/v1/chat/completions',
        gatewayId: 'gateway-newapi', apiKeySecret: null,
        modelIdOverride: 'deepseek-v3.2',
        priority: 1,
        isActive: true,
        isEnabled: true,
      },
      {
        sourceKey: 'octopus',
        sourceName: 'Octopus',
        apiUrl: 'https://octopus.example/v1/chat/completions',
        ...OCTOPUS_KEY,
        modelIdOverride: 'deepseek-v3.2',
        priority: 2,
        isActive: false,
        isEnabled: true,
      },
    ],
  });

  global.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    return Response.json({
      choices: [{ index: 0, message: { content: 'octopus-only' } }],
    });
  }) as typeof fetch;

  t.after(() => {
    serverConfigModule.getModelConfigAsync = originalGetModelConfigAsync;
    global.fetch = originalFetch;
  });

  const result = await aiModule.callAI(
    [{ role: 'user', content: 'hello' }],
    'deepseek-v3.2',
    '',
  );

  assert.equal(result, 'octopus-only');
  assert.deepEqual(urls, ['https://octopus.example/v1/chat/completions']);
});

const NEWAPI_SOURCE: AIModelSourceConfig = {
  sourceKey: 'newapi',
  sourceName: 'NewAPI',
  apiUrl: 'https://newapi.example/v1/chat/completions',
  ...NEWAPI_KEY,
  isEnabled: true,
  priority: 1,
};
const OCTOPUS_SOURCE: AIModelSourceConfig = {
  ...NEWAPI_SOURCE,
  sourceKey: 'octopus',
  sourceName: 'Octopus',
  apiUrl: 'https://octopus.example/v1/chat/completions',
  ...OCTOPUS_KEY,
  priority: 2,
};

function routingModel(overrides: Partial<AIModelConfig> = {}): AIModelConfig {
  return {
    id: 'routing-test',
    name: 'Routing test',
    modelId: 'routing-test',
    vendor: 'deepseek',
    apiUrl: NEWAPI_SOURCE.apiUrl,
    sourceKey: NEWAPI_SOURCE.sourceKey,
    supportsReasoning: false,
    ...overrides,
  };
}

const ROUTING_CASES: Array<{
  name: string;
  overrides: Partial<AIModelConfig>;
  expected: string[];
}> = [
  {
    name: 'does not revive disabled bindings from projected top-level fields',
    overrides: { sources: [{ ...NEWAPI_SOURCE, isEnabled: false }] },
    expected: [],
  },
  {
    name: 'skips a binding without an endpoint',
    overrides: { sources: [{ ...NEWAPI_SOURCE, apiUrl: '' }] },
    expected: [],
  },
  {
    name: 'skips a gateway without a saved key',
    overrides: { sources: [{ ...NEWAPI_SOURCE, apiKeySecret: null }, OCTOPUS_SOURCE] },
    expected: ['octopus'],
  },
  {
    name: 'uses an enabled backup while leaving the disabled primary excluded',
    overrides: { sources: [{ ...NEWAPI_SOURCE, isEnabled: false }, OCTOPUS_SOURCE] },
    expected: ['octopus'],
  },
  {
    name: 'keeps priority ordering without mutating the configured list',
    overrides: { sources: [OCTOPUS_SOURCE, NEWAPI_SOURCE] },
    expected: ['newapi', 'octopus'],
  },
  {
    name: 'has no source without bindings, whatever the top-level fields say',
    overrides: {},
    expected: [],
  },
];

for (const { name, overrides, expected } of ROUTING_CASES) {
  test(`source routing ${name}`, () => {
    const model = routingModel(overrides);
    const before = JSON.stringify(model);
    assert.deepEqual(getOrderedModelSources(model).map((source) => source.sourceKey), expected);
    assert.equal(JSON.stringify(model), before);
  });
}

for (const [name, overrides] of [
  ['disabled bindings', { sources: [{ ...NEWAPI_SOURCE, isEnabled: false }] }],
  ['keyless gateways', { sources: [{ ...NEWAPI_SOURCE, apiKeySecret: null }] }],
] satisfies Array<[string, Partial<AIModelConfig>]>) {
  test(`callAI rejects ${name} without making a provider request`, async (t) => {
    const ai = require('../lib/ai/ai') as typeof import('../lib/ai/ai');
    const serverConfig = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
    const originalGetModel = serverConfig.getModelConfigAsync;
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    serverConfig.getModelConfigAsync = async () => routingModel(overrides);
    global.fetch = async () => {
      fetchCalls += 1;
      throw new Error('provider must not be called without an eligible source');
    };
    t.after(() => {
      serverConfig.getModelConfigAsync = originalGetModel;
      global.fetch = originalFetch;
    });

    await assert.rejects(
      ai.callAI([{ role: 'user', content: 'hello' }], 'routing-test', ''),
      /No AI sources configured for model: routing-test/u,
    );
    assert.equal(fetchCalls, 0);
  });
}
