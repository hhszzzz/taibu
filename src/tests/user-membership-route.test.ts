import test from 'node:test';
import assert from 'node:assert/strict';


import { createMockScopedDb } from './helpers/db-mock';

function mockUserContext(user: unknown, db = createMockScopedDb()) {
  return {
    user,
    accessToken: null,
    authError: null,
    db,
  };
}

function membershipScoped(readRow: () => Promise<Record<string, unknown> | null>) {
  return createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        const query = {
          select() { return query; },
          where() { return query; },
          async executeTakeFirst() {
            assert.equal(table, 'users');
            return readRow();
          },
        };
        return query;
      },
      insertInto(table: string) {
        assert.equal(table, 'users');
        return {
          values() {
            return {
              onConflict: () => ({ execute: async () => undefined }),
            };
          },
        };
      },
    } as never),
  });
}

function installRoute(t: import('node:test').TestContext, scoped: ReturnType<typeof createMockScopedDb>, user: unknown = { id: 'user-1' }) {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/user/membership/route');

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalJsonError = apiUtilsModule.jsonError;

  apiUtilsModule.requireUserContext = async () => mockUserContext(user, scoped);
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  apiUtilsModule.jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    apiUtilsModule.jsonError = originalJsonError;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  return require('../app/api/user/membership/route') as typeof import('../app/api/user/membership/route');
}

test('user membership route should return lightweight normalized membership payload', async (t) => {
  const scoped = membershipScoped(async () => ({
    membership: 'pro',
    membership_expires_at: '2099-01-01T00:00:00.000Z',
    ai_chat_count: 88,
  }));
  const routeModule = installRoute(t, scoped);

  const response = await routeModule.GET(new Request('http://localhost/api/user/membership') as never);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.userId, 'user-1');
  assert.equal(payload.membership.type, 'pro');
  assert.equal(payload.membership.aiChatCount, 88);
  assert.equal(payload.membership.isActive, true);
});

test('user membership route should return 500 when user row is missing', async (t) => {
  const scoped = membershipScoped(async () => null);
  const routeModule = installRoute(t, scoped);

  const response = await routeModule.GET(new Request('http://localhost/api/user/membership') as never);
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, '获取会员信息失败');
});
