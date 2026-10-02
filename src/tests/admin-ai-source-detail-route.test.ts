import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

test('admin ai source PATCH should clear modelIdOverride when it matches the model key', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const serverConfigModule = require('../lib/server/ai-config') as any;
  const originalRequireAdminUser = apiUtilsModule.requireAdminUser;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalClearModelCache = serverConfigModule.clearModelCache;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  let cacheCleared = false;

  apiUtilsModule.requireAdminUser = async () => ({ user: { id: 'admin-1' } });
  apiUtilsModule.getSystemAdminClient = () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: { status: 'ok', binding: { id: 'binding-1' } }, error: null };
    },
  });
  serverConfigModule.clearModelCache = () => {
    cacheCleared = true;
  };

  t.after(() => {
    apiUtilsModule.requireAdminUser = originalRequireAdminUser;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    serverConfigModule.clearModelCache = originalClearModelCache;
  });

  const { PATCH } = await import('../app/api/admin/ai-models/[id]/sources/[sourceId]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1/sources/binding-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelIdOverride: 'gpt-5.4-mini',
    }),
  });

  const response = await PATCH(request, {
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
    p_patch: {
      model_id_override: 'gpt-5.4-mini',
    },
    p_activate: false,
  });
  assert.equal(cacheCleared, true);
});

test('admin ai source PATCH should reject non-string modelIdOverride', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const serverConfigModule = require('../lib/server/ai-config') as any;
  const originalRequireAdminUser = apiUtilsModule.requireAdminUser;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalClearModelCache = serverConfigModule.clearModelCache;

  let rpcCalled = false;
  let cacheCleared = false;

  apiUtilsModule.requireAdminUser = async () => ({ user: { id: 'admin-1' } });
  apiUtilsModule.getSystemAdminClient = () => ({
    rpc: async () => {
      rpcCalled = true;
      return { data: null, error: null };
    },
  });
  serverConfigModule.clearModelCache = () => {
    cacheCleared = true;
  };

  t.after(() => {
    apiUtilsModule.requireAdminUser = originalRequireAdminUser;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    serverConfigModule.clearModelCache = originalClearModelCache;
  });

  const { PATCH } = await import('../app/api/admin/ai-models/[id]/sources/[sourceId]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1/sources/binding-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelIdOverride: 123,
    }),
  });

  const response = await PATCH(request, {
    params: Promise.resolve({ id: 'model-1', sourceId: 'binding-1' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, 'modelIdOverride 必须是字符串或 null');
  assert.equal(rpcCalled, false);
  assert.equal(cacheCleared, false);
});

test('admin ai source PATCH should update and activate in one transactional rpc', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const serverConfigModule = require('../lib/server/ai-config') as any;
  const originalRequireAdminUser = apiUtilsModule.requireAdminUser;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalClearModelCache = serverConfigModule.clearModelCache;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.requireAdminUser = async () => ({ user: { id: 'admin-1' } });
  apiUtilsModule.getSystemAdminClient = () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: { status: 'ok', binding: { id: 'binding-1' } }, error: null };
    },
  });
  serverConfigModule.clearModelCache = () => {};

  t.after(() => {
    apiUtilsModule.requireAdminUser = originalRequireAdminUser;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    serverConfigModule.clearModelCache = originalClearModelCache;
  });

  const { PATCH } = await import('../app/api/admin/ai-models/[id]/sources/[sourceId]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1/sources/binding-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notes: 'updated',
      isActive: true,
    }),
  });

  const response = await PATCH(request, {
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
    p_patch: {
      notes: 'updated',
    },
    p_activate: true,
  });
});

test('admin ai source POST should promote binding through transactional rpc', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const serverConfigModule = require('../lib/server/ai-config') as any;
  const originalRequireAdminUser = apiUtilsModule.requireAdminUser;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalClearModelCache = serverConfigModule.clearModelCache;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  let cacheCleared = false;

  apiUtilsModule.requireAdminUser = async () => ({ user: { id: 'admin-1' } });
  apiUtilsModule.getSystemAdminClient = () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({
        data: { status: 'ok', binding: { id: 'binding-1' } },
        error: null,
      });
    },
  });
  serverConfigModule.clearModelCache = () => {
    cacheCleared = true;
  };

  t.after(() => {
    apiUtilsModule.requireAdminUser = originalRequireAdminUser;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    serverConfigModule.clearModelCache = originalClearModelCache;
  });

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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const serverConfigModule = require('../lib/server/ai-config') as any;
  const originalRequireAdminUser = apiUtilsModule.requireAdminUser;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalClearModelCache = serverConfigModule.clearModelCache;

  let cacheCleared = false;

  apiUtilsModule.requireAdminUser = async () => ({ user: { id: 'admin-1' } });
  apiUtilsModule.getSystemAdminClient = () => ({
    rpc: async () => ({
      data: { status: 'disabled_cannot_activate' },
      error: null,
    }),
  });
  serverConfigModule.clearModelCache = () => {
    cacheCleared = true;
  };

  t.after(() => {
    apiUtilsModule.requireAdminUser = originalRequireAdminUser;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    serverConfigModule.clearModelCache = originalClearModelCache;
  });

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
