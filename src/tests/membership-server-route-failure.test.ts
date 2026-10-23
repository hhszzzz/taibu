import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';
import { mockAIFeatureState } from './helpers/route-mock';

test('getEffectiveMembershipType should throw explicit error when user row lookup fails', async (t) => {
  const contextModule = require('../lib/db/context.server') as any;
  const membershipPath = require.resolve('../lib/user/membership-server');
  const originalSystemDb = contextModule.systemDb;

  contextModule.systemDb = () => createMockScopedDb({
    tx: async () => { throw new Error('db failed'); },
  });

  t.after(() => {
    contextModule.systemDb = originalSystemDb;
    delete require.cache[membershipPath];
  });

  delete require.cache[membershipPath];
  const { getEffectiveMembershipType, MembershipResolutionError } = require('../lib/user/membership-server') as typeof import('../lib/user/membership-server');

  await assert.rejects(
    () => getEffectiveMembershipType('user-1'),
    (error: unknown) => error instanceof MembershipResolutionError && /获取会员状态失败/u.test(error.message),
  );
});

test('getEffectiveMembershipType keeps a missing row an explicit failure rather than free', async (t) => {
  const contextModule = require('../lib/db/context.server') as any;
  const membershipPath = require.resolve('../lib/user/membership-server');
  const originalSystemDb = contextModule.systemDb;

  contextModule.systemDb = () => createMockScopedDb({ tx: async () => undefined });

  t.after(() => {
    contextModule.systemDb = originalSystemDb;
    delete require.cache[membershipPath];
  });

  delete require.cache[membershipPath];
  const { getEffectiveMembershipType } = require('../lib/user/membership-server') as typeof import('../lib/user/membership-server');

  await assert.rejects(() => getEffectiveMembershipType('user-1'), /获取会员状态失败/u);
});

test('/api/models should surface membership resolution failures instead of downgrading to free', async (t) => {
  mockAIFeatureState(t);
  const aiConfigServerModule = require('../lib/server/ai-config') as any;
  const membershipModule = require('../lib/user/membership-server') as any;
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/models/route');

  const originalGetModelsAsync = aiConfigServerModule.getModelsAsync;
  const originalGetEffectiveMembershipType = membershipModule.getEffectiveMembershipType;
  const originalGetAuthContext = apiUtilsModule.getAuthContext;

  aiConfigServerModule.getModelsAsync = async () => [];
  membershipModule.getEffectiveMembershipType = async () => {
    throw new membershipModule.MembershipResolutionError('获取会员状态失败');
  };
  apiUtilsModule.getAuthContext = async () => ({
    user: { id: 'user-1' },
    db: createMockScopedDb(),
  });

  t.after(() => {
    aiConfigServerModule.getModelsAsync = originalGetModelsAsync;
    membershipModule.getEffectiveMembershipType = originalGetEffectiveMembershipType;
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { GET } = require('../app/api/models/route') as typeof import('../app/api/models/route');
  const response = await GET(new NextRequest('http://localhost/api/models'));
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, '获取会员状态失败');
});

test('/api/models?catalog=byok should bypass membership failures entirely', async (t) => {
  mockAIFeatureState(t);
  const aiConfigServerModule = require('../lib/server/ai-config') as any;
  const membershipModule = require('../lib/user/membership-server') as any;
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/models/route');

  const originalGetModelsAsync = aiConfigServerModule.getModelsAsync;
  const originalGetEffectiveMembershipType = membershipModule.getEffectiveMembershipType;
  const originalGetAuthContext = apiUtilsModule.getAuthContext;

  aiConfigServerModule.getModelsAsync = async () => [];
  membershipModule.getEffectiveMembershipType = async () => {
    throw new membershipModule.MembershipResolutionError('获取会员状态失败');
  };
  apiUtilsModule.getAuthContext = async () => {
    throw new Error('auth should not be called for BYOK catalog');
  };

  t.after(() => {
    aiConfigServerModule.getModelsAsync = originalGetModelsAsync;
    membershipModule.getEffectiveMembershipType = originalGetEffectiveMembershipType;
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { GET } = require('../app/api/models/route') as typeof import('../app/api/models/route');
  const response = await GET(new NextRequest('http://localhost/api/models?catalog=byok'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.models, []);
});
