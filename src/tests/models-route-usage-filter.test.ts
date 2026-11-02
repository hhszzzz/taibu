import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { mockAIFeatureState } from './helpers/route-mock';
import { matchModelIcon } from '../lib/ai/lobe-icons';

const PRICED = { input: 1, output: 2, cacheRead: null, cacheWrite: null, image: null };

test('/api/models exposes only offered chat models with their public capabilities', async (t) => {
  mockAIFeatureState(t);
  const aiConfigServerModule = require('../lib/server/ai-config') as any;
  const apiUtilsModule = require('../lib/api-utils') as any;

  const originalGetModelsAsync = aiConfigServerModule.getModelsAsync;
  const originalGetAuthContext = apiUtilsModule.getAuthContext;

  aiConfigServerModule.getModelsAsync = async () => [
    {
      id: 'deepseek-v3.2',
      name: 'DeepSeek',
      vendor: 'deepseek',
      usageType: 'chat',
      modelId: 'deepseek-v3.2',
      apiUrl: '',
      supportsReasoning: false,
      pricing: PRICED,
    },
    {
      id: 'qwen-vl-plus',
      name: 'Qwen VL',
      vendor: 'qwen-vl',
      usageType: 'chat',
      modelId: 'qwen-vl-plus',
      apiUrl: '',
      supportsReasoning: true,
      thinkingLevels: ['low', 'high'],
      defaultReasoningEffort: 'high',
      contextWindow: 131072,
      apiKeySecret: { version: 1, iv: 'iv', tag: 'tag', data: 'ciphertext' },
      supportsVision: true,
      pricing: { ...PRICED, input: 3, output: 4 },
    },
    {
      id: 'unpriced-chat',
      name: 'Unpriced',
      vendor: 'other',
      usageType: 'chat',
      modelId: 'unpriced-chat',
      apiUrl: '',
      supportsReasoning: false,
    },
    {
      id: 'text-embedding-v4',
      name: 'Embedding',
      vendor: 'qwen',
      usageType: 'embedding',
      modelId: 'text-embedding-v4',
      apiUrl: '',
      supportsReasoning: false,
      pricing: PRICED,
    },
    {
      id: 'qwen3-rerank',
      name: 'Rerank',
      vendor: 'qwen',
      usageType: 'rerank',
      modelId: 'qwen3-rerank',
      apiUrl: '',
      supportsReasoning: false,
      pricing: PRICED,
    },
  ];
  apiUtilsModule.getAuthContext = async () => {
    throw new Error('the model catalog must not require a session');
  };

  t.after(() => {
    aiConfigServerModule.getModelsAsync = originalGetModelsAsync;
    apiUtilsModule.getAuthContext = originalGetAuthContext;
  });

  const { GET } = await import('../app/api/models/route');
  const response = await GET(new NextRequest('http://localhost/api/models'));
  const body = await response.json();

  assert.equal(response.status, 200);
  // The composer offers only the levels a thinking model lists; a model that does not think offers none.
  assert.deepEqual([body.models[0].thinkingLevels, body.models[0].defaultThinkingLevel, body.models[0].contextWindow], [[], null, null]);
  assert.deepEqual([body.models[1].thinkingLevels, body.models[1].defaultThinkingLevel, body.models[1].contextWindow], [['low', 'high'], 'high', 131072]);
  assert.doesNotMatch(JSON.stringify(body), /ciphertext|thinkingFormat|apiKey/u, 'gateway details stay on the server');
  assert.deepEqual(
    body.models.map((model: { id: string }) => model.id),
    ['deepseek-v3.2', 'qwen-vl-plus'],
    'unpriced and non-conversation models are not offered',
  );
  // Pricing is public so the composer can show what a call costs; tiers are no longer part of the catalog.
  assert.deepEqual(body.models.map((model: { pricing: unknown }) => model.pricing), [
    { input: 1, output: 2, cacheRead: null, cacheWrite: null },
    { input: 3, output: 4, cacheRead: null, cacheWrite: null },
  ]);
  assert.equal('tier' in body.models[0], false);
});

test('/api/models keeps an administrator\'s icon and otherwise names one from the model ID', async (t) => {
  mockAIFeatureState(t);
  const aiConfigServerModule = require('../lib/server/ai-config') as any;
  const originalGetModelsAsync = aiConfigServerModule.getModelsAsync;
  aiConfigServerModule.getModelsAsync = async () => [
    { id: 'deepseek-v3.2', name: 'DeepSeek', vendor: 'deepseek', usageType: 'chat', modelId: 'deepseek-v3.2', apiUrl: '', supportsReasoning: false, pricing: PRICED },
    { id: 'house-model', name: 'House', vendor: 'other', usageType: 'chat', modelId: 'claude-sonnet-4-5', icon: 'Qwen', apiUrl: '', supportsReasoning: false, pricing: PRICED },
    { id: 'mystery', name: 'Mystery', vendor: 'other', usageType: 'chat', modelId: 'mystery-model', apiUrl: '', supportsReasoning: false, pricing: PRICED },
  ];
  t.after(() => { aiConfigServerModule.getModelsAsync = originalGetModelsAsync; });

  const { GET } = await import('../app/api/models/route');
  const body = await (await GET(new NextRequest('http://localhost/api/models'))).json();
  assert.ok(matchModelIcon('deepseek-v3.2'), 'a known model ID names its icon');
  assert.deepEqual(body.models.map((model: { icon: string | null }) => model.icon), [matchModelIcon('deepseek-v3.2'), 'Qwen', null]);
  // The catalog the browser-only custom model used is gone: the parameter changes nothing.
  const legacy = await (await GET(new NextRequest('http://localhost/api/models?catalog=byok'))).json();
  assert.deepEqual(legacy.models.map((model: { id: string }) => model.id), body.models.map((model: { id: string }) => model.id));
});
