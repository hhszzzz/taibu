import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { mockAIFeatureState } from './helpers/route-mock';


test('/api/models should only expose chat and vision models', async (t) => {
  mockAIFeatureState(t);
  const aiConfigServerModule = require('../lib/server/ai-config') as any;
  const membershipModule = require('../lib/user/membership-server') as any;
  const aiAccessModule = require('../lib/ai/ai-access') as any;
  const apiUtilsModule = require('../lib/api-utils') as any;

  const originalGetModelsAsync = aiConfigServerModule.getModelsAsync;
  const originalGetEffectiveMembershipType = membershipModule.getEffectiveMembershipType;
  const originalGetModelAccessForMembershipAsync = aiAccessModule.getModelAccessForMembershipAsync;
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
    },
    {
      id: 'qwen-vl-plus',
      name: 'Qwen VL',
      vendor: 'qwen-vl',
      usageType: 'vision',
      modelId: 'qwen-vl-plus',
      apiUrl: '',
      supportsReasoning: true,
      thinkingFormat: 'qwen',
      thinkingLevels: ['low', 'high'],
      defaultReasoningEffort: 'high',
      contextWindow: 131072,
      apiKeySecret: { version: 1, iv: 'iv', tag: 'tag', data: 'ciphertext' },
      supportsVision: true,
    },
    {
      id: 'text-embedding-v4',
      name: 'Embedding',
      vendor: 'qwen',
      usageType: 'embedding',
      modelId: 'text-embedding-v4',
      apiUrl: '',
      supportsReasoning: false,
    },
    {
      id: 'qwen3-rerank',
      name: 'Rerank',
      vendor: 'qwen',
      usageType: 'rerank',
      modelId: 'qwen3-rerank',
      apiUrl: '',
      supportsReasoning: false,
    },
  ];
  membershipModule.getEffectiveMembershipType = async () => 'plus';
  aiAccessModule.getModelAccessForMembershipAsync = async () => ({
    allowed: true,
    blockedReason: null,
    reasoningAllowed: true,
  });
  apiUtilsModule.getAuthContext = async () => ({
    user: { id: 'user-1' },
  });

  t.after(() => {
    aiConfigServerModule.getModelsAsync = originalGetModelsAsync;
    membershipModule.getEffectiveMembershipType = originalGetEffectiveMembershipType;
    aiAccessModule.getModelAccessForMembershipAsync = originalGetModelAccessForMembershipAsync;
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
  );
  // The model menu labels each model with the lowest membership that can use it.
  assert.deepEqual(body.models.map((model: { tier: string | null }) => model.tier), ['free', 'plus']);
});

test('/api/models?catalog=byok should expose chat models without membership filtering', async (t) => {
  mockAIFeatureState(t);
  const aiConfigServerModule = require('../lib/server/ai-config') as any;
  const membershipModule = require('../lib/user/membership-server') as any;
  const aiAccessModule = require('../lib/ai/ai-access') as any;
  const apiUtilsModule = require('../lib/api-utils') as any;

  const originalGetModelsAsync = aiConfigServerModule.getModelsAsync;
  const originalGetEffectiveMembershipType = membershipModule.getEffectiveMembershipType;
  const originalGetModelAccessForMembershipAsync = aiAccessModule.getModelAccessForMembershipAsync;
  const originalGetAuthContext = apiUtilsModule.getAuthContext;

  aiConfigServerModule.getModelsAsync = async () => [
    {
      id: 'deepseek-v3.2',
      name: 'DeepSeek',
      vendor: 'deepseek',
      usageType: 'chat',
      modelId: 'deepseek-chat',
      apiUrl: '',
      supportsReasoning: false,
      isReasoningDefault: false,
    },
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      vendor: 'gemini',
      usageType: 'chat',
      modelId: 'gemini-2.5-pro',
      apiUrl: '',
      supportsReasoning: true,
      isReasoningDefault: false,
    },
    {
      id: 'qwen-vl-plus',
      name: 'Qwen VL',
      vendor: 'qwen-vl',
      usageType: 'vision',
      modelId: 'qwen-vl-plus',
      apiUrl: '',
      supportsReasoning: true,
      supportsVision: true,
    },
  ];
  membershipModule.getEffectiveMembershipType = async () => {
    throw new Error('membership should not be resolved for BYOK catalog');
  };
  aiAccessModule.getModelAccessForMembershipAsync = async () => {
    throw new Error('membership access should not be checked for BYOK catalog');
  };
  apiUtilsModule.getAuthContext = async () => {
    throw new Error('auth should not be required for BYOK catalog');
  };

  t.after(() => {
    aiConfigServerModule.getModelsAsync = originalGetModelsAsync;
    membershipModule.getEffectiveMembershipType = originalGetEffectiveMembershipType;
    aiAccessModule.getModelAccessForMembershipAsync = originalGetModelAccessForMembershipAsync;
    apiUtilsModule.getAuthContext = originalGetAuthContext;
  });

  const { GET } = await import('../app/api/models/route');
  const response = await GET(new NextRequest('http://localhost/api/models?catalog=byok'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.models, [
    {
      id: 'deepseek-chat',
      name: 'DeepSeek',
      vendor: 'deepseek',
      supportsReasoning: false,
      isReasoningDefault: false,
    },
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      vendor: 'gemini',
      supportsReasoning: true,
      isReasoningDefault: false,
    },
  ]);
});
