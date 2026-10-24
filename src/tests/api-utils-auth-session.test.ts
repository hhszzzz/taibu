import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';

function request(url = 'http://localhost/api/models') {
  return new NextRequest(url);
}

function adminDb(isAdmin: boolean) {
  const trx = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          executeTakeFirst: async () => ({ is_admin: isAdmin }),
        }),
      }),
    }),
  };
  return createMockScopedDb({
    tx: async (work) => work(trx as never),
  });
}

test('getAuthContext returns an anonymous scope when there is no session', async (t) => {
  const auth = require('../lib/identity/auth.server') as typeof import('../lib/identity/auth.server');
  t.mock.method(auth, 'getAuthState', async () => null);

  const { getAuthContext } = await import('../lib/api-utils');
  const result = await getAuthContext(request());

  assert.equal(result.user, null);
  assert.equal(result.authError, null);
  assert.equal(result.db.scope.kind, 'anon');
});

test('getAuthContext exposes the session user and a user scope', async (t) => {
  const auth = require('../lib/identity/auth.server') as typeof import('../lib/identity/auth.server');
  t.mock.method(auth, 'getAuthState', async () => ({
    user: {
      id: 'user-1',
      email: 'user@example.test',
      emailVerified: true,
      name: '测试用户',
      image: null,
    },
  }));

  const { getAuthContext } = await import('../lib/api-utils');
  const result = await getAuthContext(request());

  assert.equal(result.authError, null);
  assert.equal(result.user?.id, 'user-1');
  assert.equal(result.user?.email, 'user@example.test');
  assert.deepEqual(result.db.scope, { kind: 'user', userId: 'user-1' });
});

test('getAuthContext reports session resolution failures instead of masquerading as anonymous', async (t) => {
  const auth = require('../lib/identity/auth.server') as typeof import('../lib/identity/auth.server');
  t.mock.method(auth, 'getAuthState', async () => {
    throw new Error('session store unavailable');
  });

  const { getAuthContext } = await import('../lib/api-utils');
  t.mock.method(console, 'error', () => {});
  const result = await getAuthContext(request());

  assert.equal(result.user, null);
  assert.equal(result.authError?.status, 503);
  assert.equal(result.authError?.code, 'SESSION_RESOLUTION_UNAVAILABLE');
  assert.equal(result.db.scope.kind, 'anon');
});

test('requireUserContext rejects anonymous requests with 401', async (t) => {
  const auth = require('../lib/identity/auth.server') as typeof import('../lib/identity/auth.server');
  t.mock.method(auth, 'getAuthState', async () => null);

  const { requireUserContext } = await import('../lib/api-utils');
  const result = await requireUserContext(request());

  assert.deepEqual(result, { error: { message: '请先登录', status: 401 } });
});

test('requireAdminContext allows a public.users administrator', async () => {
  const { requireAdminContext } = await import('../lib/api-utils');
  const result = await requireAdminContext(request(), {
    userContext: {
      db: adminDb(true),
      user: { id: 'admin-1', email: 'admin@example.test', emailVerified: true, name: '管理员', image: null },
    },
  });

  assert.equal('error' in result, false);
  if (!('error' in result)) assert.equal(result.user.id, 'admin-1');
});

test('requireAdminContext rejects a non-administrator with 403', async () => {
  const { requireAdminContext } = await import('../lib/api-utils');
  const result = await requireAdminContext(request(), {
    userContext: {
      db: adminDb(false),
      user: { id: 'user-1', email: 'user@example.test', emailVerified: true, name: '用户', image: null },
    },
  });

  assert.deepEqual(result, { error: { message: '无权限操作', status: 403 } });
});
