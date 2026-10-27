import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sealedGateway } from './helpers/gateway-key';

const NEWAPI_KEY = sealedGateway('gateway-newapi', 'newapi-key');
const OCTOPUS_KEY = sealedGateway('gateway-octopus', 'octopus-key');

test('generateEmbedding should use unified embedding model sources and fall back to octopus', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as any;
  const modulePath = require.resolve('../lib/knowledge-base/embedding-config');
  delete require.cache[modulePath];

  const originalGetModelConfigAsync = serverConfigModule.getModelConfigAsync;
  const originalGetModelsAsync = serverConfigModule.getModelsAsync;
  const originalFetch = global.fetch;

  const urls: string[] = [];
  const auth: Array<string | null> = [];

  serverConfigModule.getModelConfigAsync = async (modelId: string) => {
    if (modelId !== 'text-embedding-v4') return undefined;
    return {
      id: 'text-embedding-v4',
      name: 'Text Embedding V4',
      vendor: 'qwen',
      usageType: 'embedding',
      modelId: 'text-embedding-v4',
      apiUrl: 'https://newapi.example/v1/embeddings',
      ...NEWAPI_KEY,
      sourceKey: 'newapi',
      transport: 'openai_compatible',
      supportsReasoning: false,
      defaultMaxTokens: 0,
      sources: [
        {
          sourceKey: 'newapi',
          sourceName: 'NewAPI',
          apiUrl: 'https://newapi.example/v1/embeddings',
          ...NEWAPI_KEY,
          modelIdOverride: 'text-embedding-v4',
          transport: 'openai_compatible',
          priority: 1,
          isActive: true,
          isEnabled: true,
        },
        {
          sourceKey: 'octopus',
          sourceName: 'Octopus',
          apiUrl: 'https://octopus.example/v1/embeddings',
          ...OCTOPUS_KEY,
          modelIdOverride: 'text-embedding-v4',
          transport: 'openai_compatible',
          priority: 2,
          isActive: false,
          isEnabled: true,
        },
      ],
    };
  };
  serverConfigModule.getModelsAsync = async () => [
    await serverConfigModule.getModelConfigAsync('text-embedding-v4'),
  ];

  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    urls.push(String(input));
    auth.push(new Headers(init?.headers).get('Authorization'));
    if (String(input).includes('newapi')) {
      return new Response('embedding failure', { status: 503 });
    }
    return Response.json({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });
  }) as typeof fetch;

  t.after(() => {
    serverConfigModule.getModelConfigAsync = originalGetModelConfigAsync;
    serverConfigModule.getModelsAsync = originalGetModelsAsync;
    global.fetch = originalFetch;
    delete require.cache[modulePath];
  });

  const embeddingModule = require('../lib/knowledge-base/embedding-config') as typeof import('../lib/knowledge-base/embedding-config');
  const embedding = await embeddingModule.generateEmbedding('hello');

  assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
  assert.deepEqual(urls, [
    'https://newapi.example/v1/embeddings',
    'https://octopus.example/v1/embeddings',
  ]);
  // Each source is called with its own gateway's saved key.
  assert.deepEqual(auth, ['Bearer newapi-key', 'Bearer octopus-key']);
});

test('callReranker should use unified rerank model sources and fall back to octopus', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as any;
  const modulePath = require.resolve('../lib/knowledge-base/reranker');
  delete require.cache[modulePath];

  const originalGetModelConfigAsync = serverConfigModule.getModelConfigAsync;
  const originalGetModelsAsync = serverConfigModule.getModelsAsync;
  const originalFetch = global.fetch;

  const urls: string[] = [];
  const auth: Array<string | null> = [];

  serverConfigModule.getModelConfigAsync = async (modelId: string) => {
    if (modelId !== 'qwen3-rerank') return undefined;
    return {
      id: 'qwen3-rerank',
      name: 'Qwen 3 Rerank',
      vendor: 'qwen',
      usageType: 'rerank',
      modelId: 'qwen3-rerank',
      apiUrl: 'https://newapi.example/v1/rerank',
      ...NEWAPI_KEY,
      sourceKey: 'newapi',
      transport: 'openai_compatible',
      supportsReasoning: false,
      defaultMaxTokens: 0,
      sources: [
        {
          sourceKey: 'newapi',
          sourceName: 'NewAPI',
          apiUrl: 'https://newapi.example/v1/rerank',
          ...NEWAPI_KEY,
          modelIdOverride: 'qwen3-rerank',
          transport: 'openai_compatible',
          priority: 1,
          isActive: true,
          isEnabled: true,
        },
        {
          sourceKey: 'octopus',
          sourceName: 'Octopus',
          apiUrl: 'https://octopus.example/v1/rerank',
          ...OCTOPUS_KEY,
          modelIdOverride: 'qwen3-rerank',
          transport: 'openai_compatible',
          priority: 2,
          isActive: false,
          isEnabled: true,
        },
      ],
    };
  };
  serverConfigModule.getModelsAsync = async () => [
    await serverConfigModule.getModelConfigAsync('qwen3-rerank'),
  ];

  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    urls.push(String(input));
    auth.push(new Headers(init?.headers).get('Authorization'));
    if (String(input).includes('newapi')) {
      return new Response('rerank failure', { status: 500 });
    }
    return Response.json({
      results: [
        { index: 1, relevance_score: 0.95 },
        { index: 0, relevance_score: 0.65 },
      ],
    });
  }) as typeof fetch;

  t.after(() => {
    serverConfigModule.getModelConfigAsync = originalGetModelConfigAsync;
    serverConfigModule.getModelsAsync = originalGetModelsAsync;
    global.fetch = originalFetch;
    delete require.cache[modulePath];
  });

  const rerankerModule = require('../lib/knowledge-base/reranker') as typeof import('../lib/knowledge-base/reranker');
  const ranked = await rerankerModule.callReranker(
    'hello',
    [
      { id: 'a', kbId: 'kb', content: 'A', metadata: {}, method: 'fts', score: 0.5 },
      { id: 'b', kbId: 'kb', content: 'B', metadata: {}, method: 'fts', score: 0.4 },
    ],
    2,
  );

  assert.deepEqual(
    ranked.map((item) => ({ id: item.id, rank: item.rank })),
    [
      { id: 'b', rank: 1 },
      { id: 'a', rank: 2 },
    ],
  );
  assert.deepEqual(urls, [
    'https://newapi.example/v1/rerank',
    'https://octopus.example/v1/rerank',
  ]);
  assert.deepEqual(auth, ['Bearer newapi-key', 'Bearer octopus-key']);
});
