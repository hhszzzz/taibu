import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { createMockScopedDb } from './helpers/db-mock';

test('admin ai source creation should reject legacy source keys', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  t.mock.method(apiUtilsModule, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }));

  const { POST } = await import('../app/api/admin/ai-models/[id]/sources/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1/sources', {
    method: 'POST',
    body: JSON.stringify({
      sourceKey: 'siliconflow',
      sourceName: 'Legacy',
      apiUrl: 'https://legacy.example/v1/chat/completions',
      apiKeyEnvVar: 'LEGACY_API_KEY',
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const response = await POST(request, { params: Promise.resolve({ id: 'model-1' }) });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, '仅支持 NewAPI 和 Octopus 来源');
});

test('admin ai source creation should reject non-string modelIdOverride', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  let rpcCalled = false;

  t.mock.method(apiUtilsModule, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }));
  t.mock.method(contextModule, 'systemDb', () => createMockScopedDb({
    rpc: async () => { rpcCalled = true; return null; },
  }) as unknown as ReturnType<typeof contextModule.systemDb>);

  const { POST } = await import('../app/api/admin/ai-models/[id]/sources/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1/sources', {
    method: 'POST',
    body: JSON.stringify({
      sourceKey: 'newapi',
      modelIdOverride: 123,
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const response = await POST(request, { params: Promise.resolve({ id: 'model-1' }) });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, 'modelIdOverride 必须是字符串或 null');
  assert.equal(rpcCalled, false);
});

test('admin ai source creation should call transactional binding rpc', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  t.mock.method(apiUtilsModule, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }));
  t.mock.method(contextModule, 'systemDb', () => createMockScopedDb({
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      return { status: 'ok', binding: { id: 'binding-1' } };
    },
  }) as unknown as ReturnType<typeof contextModule.systemDb>);

  const { POST } = await import('../app/api/admin/ai-models/[id]/sources/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1/sources', {
    method: 'POST',
    body: JSON.stringify({
      sourceKey: 'newapi',
      modelIdOverride: 'gpt-5.4-chat',
      reasoningModelId: 'gpt-5.4-reason',
      isEnabled: true,
      priority: 2,
      notes: 'primary source',
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const response = await POST(request, { params: Promise.resolve({ id: 'model-1' }) });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'admin_create_ai_model_binding');
  assert.deepEqual(rpcCall.args, {
    p_model_id: 'model-1',
    p_source_key: 'newapi',
    p_model_id_override: 'gpt-5.4-chat',
    p_reasoning_model_id: 'gpt-5.4-reason',
    p_is_enabled: true,
    p_priority: 2,
    p_notes: 'primary source',
  });
});
