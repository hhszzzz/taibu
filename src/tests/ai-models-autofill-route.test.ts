import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { modelsDevSuggestion, type ModelsDevSuggestion } from '../lib/admin/models-dev';

const GATEWAY = '0b9d5a40-1f6c-4a8e-9d5c-6a2f1e3b4c5d';

function adminModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'model-1', modelKey: 'gpt-4o', displayName: 'GPT-4o', vendor: 'openai', icon: null, usageType: 'chat',
    pricing: { input: null, output: null, cacheRead: null, cacheWrite: null, image: null },
    isEnabled: true, sortOrder: 0, supportsVision: false, isReasoningDefault: false,
    thinkingLevels: [], defaultReasoningEffort: null, contextWindow: null, defaultMaxTokens: null,
    customParameters: null,
    sources: [{ gatewayId: GATEWAY, modelIdOverride: 'gpt-4o', isEnabled: true }],
    ...overrides,
  };
}

function setup(t: TestContext) {
  const api = require('../lib/api-utils') as any;
  const store = require('../lib/admin/ai-catalog.server') as any;
  const dev = require('../lib/admin/models-dev.server') as any;

  const state = {
    admin: true,
    models: [adminModel()] as Array<Record<string, unknown>>,
    catalog: [] as ModelsDevSuggestion[],
    updateError: null as Error | null,
    updates: [] as Array<{ id: string; value: Record<string, unknown> }>,
  };

  const originals = { requireAdminUser: api.requireAdminUser, listModels: store.listModels, updateModel: store.updateModel, all: dev.allModelsDevModels };
  api.requireAdminUser = async () => (state.admin ? { user: { id: 'admin-1' } } : { error: { message: '无权限操作', status: 403 } });
  store.listModels = async () => state.models;
  store.updateModel = async (id: string, value: Record<string, unknown>) => {
    if (state.updateError) throw state.updateError;
    state.updates.push({ id, value });
  };
  dev.allModelsDevModels = async () => state.catalog;

  t.after(() => {
    api.requireAdminUser = originals.requireAdminUser;
    store.listModels = originals.listModels;
    store.updateModel = originals.updateModel;
    dev.allModelsDevModels = originals.all;
  });

  return { state, route: require('../app/api/admin/ai-models/autofill/route') as typeof import('../app/api/admin/ai-models/autofill/route') };
}

const post = () => new NextRequest('http://localhost/api/admin/ai-models/autofill', { method: 'POST' });

test('autofill refuses non-administrators before reading the catalog', async (t) => {
  const state = setup(t);
  state.state.admin = false;
  const response = await state.route.POST(post());
  assert.equal(response.status, 403);
  assert.deepEqual(state.state.updates, []);
});

test('autofill fills blanks from exact catalog matches and reports each change', async (t) => {
  const state = setup(t);
  state.state.catalog = [
    modelsDevSuggestion('openai', 'OpenAI', 'gpt-4o', {
      id: 'gpt-4o', name: 'GPT-4o', reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
      modalities: { input: ['text', 'image'] },
      limit: { context: 128_000, output: 16_384 },
      cost: { input: 2.5, output: 10, cache_read: 1.25 },
    })!,
  ];
  const response = await state.route.POST(post());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    updated: [{ name: 'GPT-4o', changes: ['上下文', '输出上限', '思考等级', '输入价', '输出价', '缓存读价'], source: 'OpenAI · gpt-4o' }],
    unchanged: 0,
    unmatched: [],
    failed: [],
  });
  assert.equal(state.state.updates.length, 1);
  const value = state.state.updates[0]!.value as Record<string, unknown>;
  assert.equal(state.state.updates[0]!.id, 'model-1');
  assert.equal(value.contextWindow, 128_000);
  assert.equal(value.defaultMaxTokens, 16_384);
  assert.deepEqual(value.thinkingLevels, ['low', 'medium', 'high']);
  assert.equal(value.defaultReasoningEffort, 'medium');
  assert.equal(value.supportsVision, false, 'image input is never switched on by autofill');
  assert.deepEqual(value.pricing, { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: null, image: null });
});

test('autofill counts unchanged models and lists the ones models.dev does not know', async (t) => {
  const state = setup(t);
  state.state.models = [
    adminModel({ id: 'm-chat', modelKey: 'unknown-chat', displayName: '未知对话' }),
    adminModel({ id: 'm-filled', modelKey: 'filled', displayName: '已填好', contextWindow: 8000, defaultMaxTokens: 4000 }),
  ];
  state.state.catalog = [
    modelsDevSuggestion('p', 'P', 'filled', { id: 'filled', name: 'Filled', limit: { context: 128_000, output: 8000 } })!,
  ];
  const payload = await (await state.route.POST(post())).json();
  assert.deepEqual(payload.unmatched, ['未知对话']);
  assert.equal(payload.unchanged, 1);
  assert.deepEqual(payload.updated, []);
  assert.deepEqual(state.state.updates, [], 'a model with nothing to fill is not written');
});

test('autofill skips non-chat models', async (t) => {
  const state = setup(t);
  state.state.models = [adminModel({ id: 'm-img', modelKey: 'img', displayName: '生图', usageType: 'image' })];
  state.state.catalog = [modelsDevSuggestion('p', 'P', 'img', { id: 'img', name: 'Img', limit: { context: 1000 } })!];
  const payload = await (await state.route.POST(post())).json();
  assert.equal(payload.unchanged, 0);
  assert.deepEqual(payload.unmatched, []);
  assert.deepEqual(state.state.updates, []);
});

test('autofill reports models whose existing input cannot be saved and catalog failures', async (t) => {
  const state = setup(t);
  const { CatalogError } = require('../lib/admin/ai-catalog.server') as typeof import('../lib/admin/ai-catalog.server');
  state.state.models = [
    adminModel({ id: 'm-bad', modelKey: 'bad', displayName: '坏来源', sources: [
      { gatewayId: GATEWAY, modelIdOverride: 'bad', isEnabled: true },
      { gatewayId: GATEWAY, modelIdOverride: 'bad', isEnabled: true },
    ] }),
    adminModel({ id: 'm-throw', modelKey: 'throws', displayName: '保存失败' }),
  ];
  state.state.catalog = [
    modelsDevSuggestion('p', 'P', 'bad', { id: 'bad', name: 'Bad', limit: { context: 128_000 } })!,
    modelsDevSuggestion('p', 'P', 'throws', { id: 'throws', name: 'Throws', limit: { context: 128_000 } })!,
  ];
  (require('../lib/admin/ai-catalog.server') as any).updateModel = async (id: string) => {
    if (id === 'm-throw') throw new CatalogError('保存时数据库不可用', 500);
  };
  const payload = await (await state.route.POST(post())).json();
  assert.deepEqual(payload.failed, [
    { name: '坏来源', error: '同一个网关只能添加一次' },
    { name: '保存失败', error: '保存时数据库不可用' },
  ]);
});
