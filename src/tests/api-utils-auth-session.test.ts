import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import type { Session, User } from '@supabase/supabase-js';
import { createMockScopedDb } from './helpers/db-mock';

type AuthResolverClientDouble = Parameters<typeof import('../lib/auth-session').resolveSessionFromTokens>[0];

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';

test('getAuthContext should refresh cookie sessions when access token has expired', async () => {
  const { getAuthContext } = await import('../lib/api-utils');
  const { ACCESS_COOKIE, REFRESH_COOKIE } = await import('../lib/auth-session');

  const user = { id: 'user-1' } as User;
  const refreshedSession = {
    access_token: 'fresh-access-token',
    refresh_token: 'fresh-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  } satisfies Session;

  const cookieWrites: Array<{ name: string; value: string; maxAge: number }> = [];
  const cookieStore = {
    set(name: string, value: string, options: { maxAge: number }) {
      cookieWrites.push({ name, value, maxAge: options.maxAge });
    },
    delete() {
      throw new Error('refreshing a valid session should not clear cookies');
    },
  };

  const request = new NextRequest('http://localhost/api/notifications?count=1&unread=1', {
    headers: {
      cookie: `${ACCESS_COOKIE}=expired-access-token; ${REFRESH_COOKIE}=refresh-cookie-token`,
    },
  });

  const result = await getAuthContext(request, {
    authResolverClient: {
      auth: {
        async getUser(accessToken: string) {
          assert.equal(accessToken, 'expired-access-token');
          return {
            data: { user: null },
            error: { message: 'JWT expired' },
          };
        },
        async refreshSession(tokens: { refresh_token: string }) {
          assert.equal(tokens.refresh_token, 'refresh-cookie-token');
          return {
            data: { session: refreshedSession },
            error: null,
          };
        },
      },
    } as ReturnType<typeof import('../lib/api-utils').createAnonClient>,
    cookieStore,
  });

  assert.equal(result.user?.id, 'user-1');
  assert.equal(result.authError, null);
  assert.equal(result.accessToken, 'fresh-access-token');
  assert.equal(typeof result.db.tx, 'function');
  assert.deepEqual(cookieWrites, [
    { name: ACCESS_COOKIE, value: 'fresh-access-token', maxAge: 3600 },
    { name: REFRESH_COOKIE, value: 'fresh-refresh-token', maxAge: 60 * 60 * 24 * 30 },
  ]);
});

test('getAuthContext should surface auth backend failures instead of masquerading as anonymous', async () => {
  const { getAuthContext } = await import('../lib/api-utils');
  const { ACCESS_COOKIE } = await import('../lib/auth-session');

  const request = new NextRequest('http://localhost/api/models', {
    headers: {
      cookie: `${ACCESS_COOKIE}=broken-access-token`,
    },
  });

  const result = await getAuthContext(request, {
    // Validate the resolver surface while leaving unrelated SDK members out of this double.
    authResolverClient: {
      auth: {
        async getUser() {
          return {
            data: { user: null },
            error: { message: 'Auth backend unavailable', status: 503 },
          };
        },
        async refreshSession() {
          throw new Error('refreshSession should not run without refresh token');
        },
      },
    } satisfies AuthResolverClientDouble as unknown as ReturnType<typeof import('../lib/api-utils').createAnonClient>,
  });

  assert.equal(result.user, null);
  assert.equal(result.authError?.message, 'Auth backend unavailable');
  assert.equal(result.authError?.status, 503);
});

test('requireAdminContext should surface admin-check backend failures instead of returning a fake 403', async () => {
  const { requireAdminContext } = await import('../lib/api-utils');
  const request = new NextRequest('http://localhost/api/admin/announcements');
  // The admin-check double fails at the database boundary, not with a 403-shaped result.
  const db = createMockScopedDb({
    tx: async () => { throw new Error('db timeout'); },
  });

  const result = await requireAdminContext(request, {
    userContext: {
      user: { id: 'admin-1' } as User,
      db,
    },
  });

  assert.deepEqual(result, {
    error: {
      message: '管理员权限校验失败，请稍后重试',
      status: 503,
    },
  });
});

test('session clients keep SDK mutations private to their request without changing caller objects', async (t) => {
  const { createSessionClient } = await import('../lib/api-utils');
  const { buildSessionFromUser } = await import('../lib/auth-session');
  const { createMockAuthContext } = await import('./helpers/supabase-mock');
  const sessions = ['first', 'second'].map(id => buildSessionFromUser(createMockAuthContext({}, id).user, `token-${id}`, ''));
  const clients = sessions.map(createSessionClient);
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const token = new Headers(init?.headers).get('authorization');
    const original = sessions.find(session => token === `Bearer ${session.access_token}`);
    assert.ok(original, 'must use this request caller token');
    return Response.json({ ...original.user, user_metadata: { changed: original.user.id } });
  });
  await Promise.all(clients.map(async (client, index) => {
    const result = await client.auth.updateUser({ data: { changed: sessions[index].user.id } });
    assert.equal(result.error, null);
    assert.equal(result.data.user?.id, sessions[index].user.id);
  }));
  for (const [index, client] of clients.entries()) {
    const { data, error } = await client.auth.getSession();
    assert.equal(error, null);
    assert.equal(data.session?.access_token, sessions[index].access_token);
    assert.deepEqual(data.session?.user.user_metadata, { changed: sessions[index].user.id });
    assert.equal(sessions[index].user.user_metadata.changed, undefined, 'SDK mutation must not modify the verified input');
  }
});

test('browser auth client should not expose table query or rpc helpers', async () => {
  const { supabase } = await import('../lib/auth');

  assert.equal('from' in (supabase as Record<string, unknown>), false);
  assert.equal('rpc' in (supabase as Record<string, unknown>), false);
});

test('supabase env helpers should fall back to NEXT_PUBLIC values when server env is absent', async () => {
  const { getSupabaseAnonKey, getSupabaseUrl } = await import('../lib/supabase-env');
  const previousUrl = process.env.SUPABASE_URL;
  const previousAnonKey = process.env.SUPABASE_ANON_KEY;
  const previousPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousPublicAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-anon-key';

  try {
    assert.equal(getSupabaseUrl(), 'https://example.supabase.co');
    assert.equal(getSupabaseAnonKey(), 'public-anon-key');
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;

    if (previousAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousAnonKey;

    if (previousPublicUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousPublicUrl;

    if (previousPublicAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousPublicAnonKey;
  }
});
