import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

test('admin ai source creation should reject legacy source keys', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const originalRequireAdminUser = apiUtilsModule.requireAdminUser;

  apiUtilsModule.requireAdminUser = async () => ({ user: { id: 'admin-1' } });

  t.after(() => {
    apiUtilsModule.requireAdminUser = originalRequireAdminUser;
  });

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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const originalRequireAdminUser = apiUtilsModule.requireAdminUser;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;

  let rpcCalled = false;

  apiUtilsModule.requireAdminUser = async () => ({ user: { id: 'admin-1' } });
  apiUtilsModule.getSystemAdminClient = () => ({
    rpc: async () => {
      rpcCalled = true;
      return { data: null, error: null };
    },
  });

  t.after(() => {
    apiUtilsModule.requireAdminUser = originalRequireAdminUser;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
  });

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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const originalRequireAdminUser = apiUtilsModule.requireAdminUser;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.requireAdminUser = async () => ({ user: { id: 'admin-1' } });
  apiUtilsModule.getSystemAdminClient = () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return {
        data: {
          status: 'ok',
          binding: { id: 'binding-1' },
        },
        error: null,
      };
    },
  });

  t.after(() => {
    apiUtilsModule.requireAdminUser = originalRequireAdminUser;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
  });

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
