import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { createMockScopedDb } from './helpers/db-mock';

function adminDb(t: TestContext, db: ReturnType<typeof createMockScopedDb>) {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  t.mock.method(apiUtilsModule, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }));
  t.mock.method(contextModule, 'systemDb', () => db as unknown as ReturnType<typeof contextModule.systemDb>);
}

test('admin ai model PATCH should update editable base fields including modelKey', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  let rpcArgs: Record<string, unknown> | null = null;
  let cacheCleared = false;

  adminDb(t, createMockScopedDb({
    rpc: (fn, args) => {
      assert.equal(fn, 'admin_update_ai_model_and_cleanup_bindings');
      rpcArgs = args;
      return { status: 'ok', model: { id: 'model-1' } };
    },
  }));
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { PATCH } = await import('../app/api/admin/ai-models/[id]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelKey: 'gpt-5.4-mini',
      displayName: 'ChatGPT 5.4 Mini',
      vendor: 'openai',
      description: 'edited',
    }),
  });

  const response = await PATCH(request, { params: Promise.resolve({ id: 'model-1' }) });

  assert.equal(response.status, 200);
  assert.deepEqual(rpcArgs, {
    p_model_id: 'model-1',
    p_patch: {
      model_key: 'gpt-5.4-mini',
      display_name: 'ChatGPT 5.4 Mini',
      vendor: 'openai',
      description: 'edited',
    },
  });
  assert.equal(cacheCleared, true);
});

test('admin ai model PATCH should not clear inherited bindings when validation fails', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  let cacheCleared = false;

  adminDb(t, createMockScopedDb());
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { PATCH } = await import('../app/api/admin/ai-models/[id]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelKey: 'gpt-5.4-mini',
      usageType: 'invalid-type',
    }),
  });

  const response = await PATCH(request, { params: Promise.resolve({ id: 'model-1' }) });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, '无效的 usageType 值');
  assert.equal(cacheCleared, false);
});

test('admin ai model DELETE should remove model and clear cache', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  let deletedModelId: string | null = null;
  let cacheCleared = false;

  adminDb(t, createMockScopedDb({
    tx: async (work) => work({
      deleteFrom: (table: string) => {
        assert.equal(table, 'ai_models');
        return {
          where: (column: string, _operator: string, value: string) => {
            assert.equal(column, 'id');
            deletedModelId = value;
            return { execute: async () => undefined };
          },
        };
      },
    } as never),
  }));
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { DELETE } = await import('../app/api/admin/ai-models/[id]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1', {
    method: 'DELETE',
  });

  const response = await DELETE(request, { params: Promise.resolve({ id: 'model-1' }) });

  assert.equal(response.status, 200);
  assert.equal(deletedModelId, 'model-1');
  assert.equal(cacheCleared, true);
});

test('admin ai model PATCH should return 409 when transactional update reports model key conflict', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');

  let cacheCleared = false;

  adminDb(t, createMockScopedDb({ rpc: () => ({ status: 'conflict' }) }));
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { PATCH } = await import('../app/api/admin/ai-models/[id]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-models/model-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelKey: 'gpt-5.4-mini',
      displayName: 'ChatGPT 5.4 Mini',
      description: 'after',
    }),
  });

  const response = await PATCH(request, { params: Promise.resolve({ id: 'model-1' }) });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error, '模型 ID 已存在');
  assert.equal(cacheCleared, false);
});
