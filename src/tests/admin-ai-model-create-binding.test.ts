import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { createMockScopedDb } from './helpers/db-mock';

function adminRpc(t: TestContext, rpc: (fn: string, args: Record<string, unknown>) => unknown) {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  t.mock.method(apiUtilsModule, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }));
  t.mock.method(contextModule, 'systemDb', () => createMockScopedDb({ rpc }) as unknown as ReturnType<typeof contextModule.systemDb>);
}

test('admin ai models POST should create a primary gateway binding for the selected routing mode', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  let rpcArgs: Record<string, unknown> | null = null;
  let cacheCleared = false;

  adminRpc(t, (fn, args) => {
    assert.equal(fn, 'admin_create_ai_model_with_binding');
    rpcArgs = args;
    return { status: 'ok', model: { id: 'model-1', model_key: 'gpt-5.4' } };
  });
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { POST } = await import('../app/api/admin/ai-models/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelKey: 'gpt-5.4',
      displayName: 'ChatGPT 5.4',
      vendor: 'openai',
      routingMode: 'newapi',
    }),
  });

  const response = await POST(request);
  assert.equal(response.status, 201);
  assert.deepEqual(rpcArgs, {
    p_model: {
      model_key: 'gpt-5.4',
      display_name: 'ChatGPT 5.4',
      vendor: 'openai',
      usage_type: 'chat',
      routing_mode: 'newapi',
      is_enabled: true,
      sort_order: 0,
      required_tier: 'free',
      supports_reasoning: false,
      reasoning_required_tier: 'plus',
      is_reasoning_default: false,
      supports_vision: false,
      default_temperature: 0.7,
      default_top_p: null,
      default_presence_penalty: null,
      default_frequency_penalty: null,
      default_max_tokens: null,
      default_reasoning_effort: null,
      reasoning_effort_format: null,
      custom_parameters: null,
      description: undefined,
    },
    p_primary_gateway_key: 'newapi',
  });
  assert.equal(cacheCleared, true);
});

test('admin ai models POST should return 404 when transactional create cannot resolve primary gateway', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  let cacheCleared = false;

  adminRpc(t, () => ({ status: 'gateway_not_found' }));
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { POST } = await import('../app/api/admin/ai-models/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelKey: 'gpt-5.4',
      displayName: 'ChatGPT 5.4',
      vendor: 'openai',
      routingMode: 'newapi',
    }),
  });

  const response = await POST(request);
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error, '来源网关不存在，请先在网关管理中配置');
  assert.equal(cacheCleared, false);
});

test('admin ai models POST should return 500 when transactional create RPC fails', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  let cacheCleared = false;

  adminRpc(t, () => { throw new Error('transaction failed'); });
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { POST } = await import('../app/api/admin/ai-models/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelKey: 'gpt-5.4',
      displayName: 'ChatGPT 5.4',
      vendor: 'openai',
      routingMode: 'newapi',
    }),
  });

  const response = await POST(request);
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, '创建模型失败');
  assert.equal(cacheCleared, false);
});
