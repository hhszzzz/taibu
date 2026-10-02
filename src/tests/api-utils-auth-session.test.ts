import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import type { Session, User } from '@supabase/supabase-js';

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

  let refreshedAccessToken: string | null = null;
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
    authedClientFactory(token: string) {
      refreshedAccessToken = token;
      return {
        auth: {
          async getUser() {
            return { data: { user }, error: null };
          },
        },
      } as ReturnType<typeof import('../lib/api-utils').createAuthedClient>;
    },
    cookieStore,
  });

  assert.equal(result.user?.id, 'user-1');
  assert.equal(result.authError, null);
  assert.equal(refreshedAccessToken, 'fresh-access-token');
  assert.deepEqual(cookieWrites, [
    { name: ACCESS_COOKIE, value: 'fresh-access-token', maxAge: 3600 },
    { name: REFRESH_COOKIE, value: 'fresh-refresh-token', maxAge: 60 * 60 * 24 * 30 },
  ]);
});

test('requireBearerUser returns one caller-scoped DB client without using cookie refresh', async () => {
  const { requireBearerUser } = await import('../lib/api-utils');
  const { createMockAuthContext } = await import('./helpers/supabase-mock');
  const { ACCESS_COOKIE, REFRESH_COOKIE } = await import('../lib/auth-session');
  const caller = createMockAuthContext({ from: () => assert.fail('authentication must not query application tables') });
  const tokens: string[] = [];
  const result = await requireBearerUser(new NextRequest('http://localhost/api/mbti', {
    headers: {
      authorization: 'Bearer caller-bearer-token',
      cookie: `${ACCESS_COOKIE}=other-user-cookie-token; ${REFRESH_COOKIE}=refresh-cookie-token`,
    },
  }), {
    authResolverClient: {
      auth: {
        async getUser(token: string) {
          assert.equal(token, 'caller-bearer-token');
          return { data: { user: caller.user }, error: null };
        },
        async refreshSession() {
          assert.fail('bearer-only auth must not refresh cookie sessions');
        },
      },
    } satisfies AuthResolverClientDouble as unknown as ReturnType<typeof import('../lib/api-utils').createAnonClient>,
    authedClientFactory(token) {
      tokens.push(token);
      return caller.db;
    },
  });
  assert.ok(!('error' in result));
  assert.equal(result.user, caller.user);
  assert.equal(result.db, caller.db);
  assert.equal(result.supabase, caller.db);
  assert.equal(result.accessToken, 'caller-bearer-token');
  assert.deepEqual(tokens, ['caller-bearer-token']);
});

test('requireBearerUser should reject stale bearer tokens even when a refresh cookie is present', async () => {
  const { requireBearerUser } = await import('../lib/api-utils');
  const { REFRESH_COOKIE } = await import('../lib/auth-session');

  let refreshCalled = false;

  // This SDK double implements only the session resolver contract exercised below.
  const authResolverClient = {
    auth: {
      async getUser(accessToken: string) {
        assert.equal(accessToken, 'expired-bearer-token');
        return {
          data: { user: null },
          error: { message: 'JWT expired' },
        };
      },
      async refreshSession(tokens: { refresh_token: string }) {
        void tokens;
        refreshCalled = true;
        throw new Error('refreshSession should not be called for bearer-only auth');
      },
    },
  } satisfies AuthResolverClientDouble as unknown as ReturnType<typeof import('../lib/api-utils').createAnonClient>;

  const request = new NextRequest('http://localhost/api/mbti', {
    headers: {
      authorization: 'Bearer expired-bearer-token',
      cookie: `${REFRESH_COOKIE}=refresh-cookie-token`,
    },
  });

  const result = await requireBearerUser(request, { authResolverClient });
  assert.deepEqual(result, {
    error: {
      message: '认证失败',
      status: 401,
    },
  });
  assert.equal(refreshCalled, false);
});

test('requireBearerUser should preserve access-token backend failures even when refresh token is present', async () => {
  const { requireBearerUser } = await import('../lib/api-utils');
  const { REFRESH_COOKIE } = await import('../lib/auth-session');

  const request = new NextRequest('http://localhost/api/mbti', {
    headers: {
      authorization: 'Bearer broken-bearer-token',
      cookie: `${REFRESH_COOKIE}=stale-refresh-token`,
    },
  });

  const result = await requireBearerUser(request, {
    authResolverClient: {
      auth: {
        async getUser() {
          return {
            data: { user: null },
            error: { message: 'Auth backend unavailable', status: 503 },
          };
        },
        async refreshSession() {
          return {
            data: { session: null },
            error: { message: 'Invalid Refresh Token', status: 400 },
          };
        },
      },
    } as ReturnType<typeof import('../lib/api-utils').createAnonClient>,
  });

  assert.deepEqual(result, {
    error: {
      message: 'Auth backend unavailable',
      status: 503,
    },
  });
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
  // The admin-check double provides only its query chain, not a complete Supabase SDK client.
  const db = {
    from(table: string) {
      assert.equal(table, 'users');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({
          data: null,
          error: { message: 'db timeout' },
        }),
      };
    },
  } as unknown as Awaited<ReturnType<typeof import('../lib/api-utils').createAuthedClient>>;

  const result = await requireAdminContext(request, {
    userContext: {
      user: { id: 'admin-1' } as User,
      accessToken: null,
      db,
      supabase: db,
    },
  });

  assert.deepEqual(result, {
    error: {
      message: '管理员权限校验失败，请稍后重试',
      status: 503,
    },
  });
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
