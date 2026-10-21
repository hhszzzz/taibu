import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';

type RpcCall = { fn: string; args: Record<string, unknown> };

function adminRpc(t: TestContext, rpc: (fn: string, args: Record<string, unknown>) => unknown) {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  t.mock.method(apiUtilsModule, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }));
  t.mock.method(contextModule, 'systemDb', () => createMockScopedDb({ rpc }) as unknown as ReturnType<typeof contextModule.systemDb>);
}

test('admin ai source PATCH should clear modelIdOverride when it matches the model key', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  const rpcCalls: RpcCall[] = [];
  let cacheCleared = false;

  adminRpc(t, (fn, args) => {
    rpcCalls.push({ fn, args });
    return { status: 'ok', binding: { id: 'binding-1' } };
  });
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { PATCH } = await import('../app/api/admin/ai-models/[id]/sources/[sourceId]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1/sources/binding-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelIdOverride: 'gpt-5.4-mini' }),
  });

  const response = await PATCH(request, { params: Promise.resolve({ id: 'model-1', sourceId: 'binding-1' }) });

  assert.equal(response.status, 200);
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'admin_update_ai_model_binding');
  assert.deepEqual(rpcCall.args, {
    p_model_id: 'model-1',
    p_source_id: 'binding-1',
    p_patch: { model_id_override: 'gpt-5.4-mini' },
    p_activate: false,
  });
  assert.equal(cacheCleared, true);
});

test('admin ai source PATCH should reject non-string modelIdOverride', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  let rpcCalled = false;
  let cacheCleared = false;

  adminRpc(t, () => { rpcCalled = true; return null; });
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { PATCH } = await import('../app/api/admin/ai-models/[id]/sources/[sourceId]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1/sources/binding-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelIdOverride: 123 }),
  });

  const response = await PATCH(request, { params: Promise.resolve({ id: 'model-1', sourceId: 'binding-1' }) });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, 'modelIdOverride 必须是字符串或 null');
  assert.equal(rpcCalled, false);
  assert.equal(cacheCleared, false);
});

test('admin ai source PATCH should update and activate in one transactional rpc', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  const rpcCalls: RpcCall[] = [];

  adminRpc(t, (fn, args) => {
    rpcCalls.push({ fn, args });
    return { status: 'ok', binding: { id: 'binding-1' } };
  });
  t.mock.method(serverConfigModule, 'clearModelCache', () => {});

  const { PATCH } = await import('../app/api/admin/ai-models/[id]/sources/[sourceId]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1/sources/binding-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'updated', isActive: true }),
  });

  const response = await PATCH(request, { params: Promise.resolve({ id: 'model-1', sourceId: 'binding-1' }) });

  assert.equal(response.status, 200);
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'admin_update_ai_model_binding');
  assert.deepEqual(rpcCall.args, {
    p_model_id: 'model-1',
    p_source_id: 'binding-1',
    p_patch: { notes: 'updated' },
    p_activate: true,
  });
});

test('admin ai source POST should promote binding through transactional rpc', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  const rpcCalls: RpcCall[] = [];
  let cacheCleared = false;

  adminRpc(t, (fn, args) => {
    rpcCalls.push({ fn, args });
    return { status: 'ok', binding: { id: 'binding-1' } };
  });
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { POST } = await import('../app/api/admin/ai-models/[id]/sources/[sourceId]/route');
  const response = await POST(new NextRequest('http://localhost/api/admin/ai-models/model-1/sources/binding-1', {
    method: 'POST',
  }), {
    params: Promise.resolve({ id: 'model-1', sourceId: 'binding-1' }),
  });

  assert.equal(response.status, 200);
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'admin_update_ai_model_binding');
  assert.deepEqual(rpcCall.args, {
    p_model_id: 'model-1',
    p_source_id: 'binding-1',
    p_patch: {},
    p_activate: true,
  });
  assert.equal(cacheCleared, true);
});

test('admin ai source POST should reject disabled bindings through transactional rpc status', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  let cacheCleared = false;

  adminRpc(t, () => ({ status: 'disabled_cannot_activate' }));
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { POST } = await import('../app/api/admin/ai-models/[id]/sources/[sourceId]/route');
  const response = await POST(new NextRequest('http://localhost/api/admin/ai-models/model-1/sources/binding-1', {
    method: 'POST',
  }), {
    params: Promise.resolve({ id: 'model-1', sourceId: 'binding-1' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, '无法激活已禁用的来源');
  assert.equal(cacheCleared, false);
});
