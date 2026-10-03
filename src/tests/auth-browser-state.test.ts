import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { SessionContext } from '../lib/hooks/session-context';
import { EMPTY_APP_BOOTSTRAP, type AppBootstrapData } from '../lib/app/bootstrap';
import { buildMembershipInfo } from '../lib/user/membership';
import { createMockAuthContext } from './helpers/supabase-mock';

type BootstrapSnapshot = ReturnType<typeof import('../lib/hooks/useAppBootstrap').useAppBootstrap>;

function bootstrapSnapshot(data: AppBootstrapData, state: Pick<BootstrapSnapshot, 'hasBootstrapData' | 'viewerStateLoaded' | 'viewerStateResolved'>): BootstrapSnapshot {
  const client = new QueryClient();
  const result = new QueryObserver(client, { queryKey: ['hook-fixture'], queryFn: async () => data, enabled: false }).getCurrentResult();
  client.clear();
  return { ...result, data, ...state, viewerStateError: null, refresh: async () => data, markCreditsExhausted() {} };
}

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

test('checkLoginAttempts should return an explicit guard error instead of failing open', async () => {
  const browserApiModule = require('../lib/browser-api') as typeof import('../lib/browser-api');
  const authPath = require.resolve('../lib/auth');
  const originalRequestBrowserJson = browserApiModule.requestBrowserJson;

  browserApiModule.requestBrowserJson = async () => ({
    data: null,
    error: { message: 'guard backend down', code: 'guard_backend_down' },
  });

  try {
    delete require.cache[authPath];
    const { checkLoginAttempts, authSessionCacheConstants } = require('../lib/auth') as typeof import('../lib/auth');
    const result = await checkLoginAttempts('user@example.com');

    assert.deepEqual(result, {
      blocked: false,
      remainingAttempts: 5,
      error: {
        message: authSessionCacheConstants.LOGIN_GUARD_UNAVAILABLE_MESSAGE,
        code: 'guard_backend_down',
      },
    });
  } finally {
    browserApiModule.requestBrowserJson = originalRequestBrowserJson;
    delete require.cache[authPath];
  }
});

test('signInWithEmailProtected should fail closed when the login guard is unavailable', async () => {
  const browserApiModule = require('../lib/browser-api') as typeof import('../lib/browser-api');
  const authPath = require.resolve('../lib/auth');
  const originalRequestBrowserJson = browserApiModule.requestBrowserJson;
  const calls: Array<{ url: string; method?: string }> = [];

  browserApiModule.requestBrowserJson = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method });
    return {
      data: null,
      error: { message: 'guard backend down', code: 'guard_backend_down' },
    };
  };

  try {
    delete require.cache[authPath];
    const { signInWithEmailProtected, authSessionCacheConstants } = require('../lib/auth') as typeof import('../lib/auth');
    const result = await signInWithEmailProtected('user@example.com', 'password');

    assert.deepEqual(result, {
      success: false,
      error: {
        message: authSessionCacheConstants.LOGIN_GUARD_UNAVAILABLE_MESSAGE,
        code: 'guard_backend_down',
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, '/api/auth');
  } finally {
    browserApiModule.requestBrowserJson = originalRequestBrowserJson;
    delete require.cache[authPath];
  }
});

test('browser auth session cache should support explicit invalidate and revalidate flows', async () => {
  const authPath = require.resolve('../lib/auth');
  const originalFetch = global.fetch;
  let callCount = 0;

  global.fetch = async () => {
    callCount += 1;
    const userId = `user-${callCount}`;
    return Response.json({
      data: {
        session: {
          access_token: `access-token-${callCount}`,
          refresh_token: `refresh-token-${callCount}`,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: userId },
        },
        user: { id: userId },
      },
      error: null,
    });
  };

  try {
    delete require.cache[authPath];
    const { supabase } = require('../lib/auth') as typeof import('../lib/auth');

    const first = await supabase.auth.getSession();
    const second = await supabase.auth.getSession();
    supabase.auth.invalidateSessionCache();
    const third = await supabase.auth.getSession();
    const events: Array<{ event: string; userId: string | null }> = [];
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      events.push({ event, userId: session?.user?.id ?? null });
    });
    await new Promise((resolve) => setImmediate(resolve));
    const fourth = await supabase.auth.revalidateSession();

    subscription.unsubscribe();
    assert.equal(first.data.session?.user?.id, 'user-1');
    assert.equal(second.data.session?.user?.id, 'user-1');
    assert.equal(third.data.session?.user?.id, 'user-2');
    assert.equal(fourth.data.session?.user?.id, 'user-3');
    assert.equal(callCount, 3);
    assert.deepEqual(events, [
      { event: 'INITIAL_SESSION', userId: 'user-2' },
      { event: 'TOKEN_REFRESHED', userId: 'user-3' },
    ]);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[authPath];
  }
});

test('useAppBootstrap should defer viewer failures briefly before surfacing them', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/hooks/useAppBootstrap.ts'), 'utf8');

  assert.match(source, /const VIEWER_STATE_ERROR_GRACE_MS = 3_000;/u);
  assert.match(source, /const VIEWER_STATE_RETRY_INTERVAL_MS = 800;/u);
  assert.match(source, /if \(viewerPendingKey && !viewerFailureTimedOut\)/u);
});

test('session membership distinguishes anonymous, pending, failed, loaded and refreshing viewer states', async (t) => {
  const bootstrapModule = require('../lib/hooks/useAppBootstrap') as typeof import('../lib/hooks/useAppBootstrap');
  const { useSessionMembership } = require('../lib/hooks/useSessionMembership') as typeof import('../lib/hooks/useSessionMembership');
  const user = createMockAuthContext({}, 'user-1').user;
  const membership = buildMembershipInfo({ membership: 'pro', ai_chat_count: 12 });
  const cases = [
    { name: 'anonymous', user: null, sessionLoading: false, loaded: false, resolved: false, expectedResolved: true, expectedLoading: false },
    { name: 'initial session', user: null, sessionLoading: true, loaded: false, resolved: false, expectedResolved: true, expectedLoading: true },
    { name: 'pending viewer failure grace', user, sessionLoading: false, loaded: false, resolved: false, expectedResolved: false, expectedLoading: true },
    { name: 'settled viewer failure', user, sessionLoading: false, loaded: false, resolved: true, expectedResolved: true, expectedLoading: false },
    { name: 'loaded membership', user, sessionLoading: false, loaded: true, resolved: true, expectedResolved: true, expectedLoading: false },
    { name: 'session refreshing', user, sessionLoading: true, loaded: true, resolved: true, expectedResolved: true, expectedLoading: true },
  ];
  let snapshot = bootstrapSnapshot(EMPTY_APP_BOOTSTRAP, { hasBootstrapData: false, viewerStateLoaded: false, viewerStateResolved: false });
  t.mock.method(bootstrapModule, 'useAppBootstrap', () => snapshot);
  const observed: ReturnType<typeof useSessionMembership>[] = [];
  function Probe() { observed.push(useSessionMembership()); return null; }

  for (const scenario of cases) {
    snapshot = bootstrapSnapshot({ ...EMPTY_APP_BOOTSTRAP, viewerLoaded: scenario.loaded, membership }, {
      hasBootstrapData: true, viewerStateLoaded: scenario.loaded, viewerStateResolved: scenario.resolved,
    });
    renderToStaticMarkup(React.createElement(SessionContext.Provider, {
      value: { session: null, user: scenario.user, loading: scenario.sessionLoading },
    }, React.createElement(Probe)));
    const actual = observed.pop();
    assert.ok(actual, scenario.name);
    assert.equal(actual.user, scenario.user, scenario.name);
    assert.equal(actual.membershipResolved, scenario.expectedResolved, scenario.name);
    assert.equal(actual.membershipLoading, scenario.expectedLoading, scenario.name);
    assert.equal(actual.membershipInfo, scenario.loaded ? membership : null, scenario.name);
    assert.equal(await actual.refreshMembership(), scenario.loaded ? membership : null, scenario.name);
  }
});

test('useFeatureToggles keeps unloaded bootstrap pending without exposing features or an error', (t) => {
  const bootstrapModule = require('../lib/hooks/useAppBootstrap') as typeof import('../lib/hooks/useAppBootstrap');
  const { useFeatureToggles } = require('../lib/hooks/useFeatureToggles') as typeof import('../lib/hooks/useFeatureToggles');
  t.mock.method(bootstrapModule, 'useAppBootstrap', () => bootstrapSnapshot(EMPTY_APP_BOOTSTRAP, {
    hasBootstrapData: false, viewerStateLoaded: false, viewerStateResolved: false,
  }));
  const observed: ReturnType<typeof useFeatureToggles>[] = [];
  function Probe() { observed.push(useFeatureToggles()); return null; }
  renderToStaticMarkup(React.createElement(Probe));
  const actual = observed[0];
  assert.equal(actual.isLoading, true);
  assert.equal(actual.loaded, false);
  assert.equal(actual.error, null);
  assert.equal(actual.isFeatureEnabled('chat'), false);
});

for (const scenario of ['valid', 'bearer-only', 'refreshed', 'update-error', 'refreshed-update-error', 'anonymous', 'session-error'] as const) {
  test(`auth updateUser ${scenario} uses an isolated caller session`, async (t) => {
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const sessions = require('../lib/auth-session') as typeof import('../lib/auth-session');
    const { user } = createMockAuthContext({}, `update-${scenario}`);
    const refreshed = scenario === 'refreshed' || scenario === 'refreshed-update-error';
    const updateRejected = scenario === 'update-error' || scenario === 'refreshed-update-error';
    const token = refreshed ? 'rotated-access-token' : `validated-${scenario}`;
    const session = sessions.buildSessionFromUser(user, token, scenario === 'bearer-only' ? '' : 'rotated-refresh-token');
    t.mock.method(sessions, 'resolveSessionFromTokens', async () => ({
      session: scenario === 'anonymous' || scenario === 'session-error' ? null : session,
      refreshed,
      error: scenario === 'session-error' ? { message: 'Auth unavailable', status: 503, code: 'auth_unavailable' } : null,
    }));
    const attributes = { data: { display_name: 'Local fixture' } };
    const updatedUser = { ...user, user_metadata: attributes.data };
    const requests: Array<{ path: string; method: string | undefined; authorization: string | null; body: unknown }> = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({ path: url.pathname, method: init?.method, authorization: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
      return updateRejected
        ? Response.json({ msg: 'Update rejected', error_code: 'update_rejected' }, { status: 400 })
        : Response.json(updatedUser);
    });
    t.mock.method(apiUtils, 'getAuthAdminClient', () => assert.fail('user update must not acquire a privileged client'));
    t.mock.method(apiUtils, 'getSystemAdminClient', () => assert.fail('user update must not acquire a system administrator'));
    const { POST } = require('../app/api/auth/route') as typeof import('../app/api/auth/route');
    const response = await POST(new NextRequest('http://localhost/api/auth', {
      method: 'POST',
      headers: scenario === 'bearer-only'
        ? { 'content-type': 'application/json', authorization: 'Bearer original-bearer' }
        : { 'content-type': 'application/json', cookie: `${sessions.ACCESS_COOKIE}=stale-access; ${sessions.REFRESH_COOKIE}=stale-refresh` },
      body: JSON.stringify({ action: 'updateUser', attributes, token: 'untrusted-body-token' }),
    }));
    assert.equal(response.status, scenario === 'session-error' ? 503 : scenario === 'anonymous' ? 401 : updateRejected ? 400 : 200);
    assert.deepEqual(requests, scenario === 'anonymous' || scenario === 'session-error' ? [] : [{
      path: '/auth/v1/user', method: 'PUT', authorization: `Bearer ${token}`,
      body: { ...attributes, code_challenge: null, code_challenge_method: null },
    }]);
    const payload = await response.json();
    if (scenario === 'anonymous' || scenario === 'session-error' || updateRejected) {
      assert.equal(payload.data, null);
      if (updateRejected) assert.equal(payload.error.code, 'update_rejected');
    } else {
      assert.deepEqual(payload, { data: { user: updatedUser }, error: null });
    }
    if (refreshed) {
      assert.equal(response.cookies.get(sessions.ACCESS_COOKIE)?.value, token);
      assert.equal(response.cookies.get(sessions.REFRESH_COOKIE)?.value, session.refresh_token);
    } else {
      assert.equal(response.headers.get('set-cookie'), null);
    }
  });
}

for (const scenario of ['valid', 'refreshed', 'revocation-error', 'anonymous', 'session-error'] as const) {
  test(`auth logout ${scenario} uses token-scoped revocation before clearing cookies`, async (t) => {
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const sessions = require('../lib/auth-session') as typeof import('../lib/auth-session');
    const { user } = createMockAuthContext({}, 'logout-user');
    const token = scenario === 'refreshed' ? 'newly-refreshed-token' : 'validated-access-token';
    const session = sessions.buildSessionFromUser(user, token, 'fixture-refresh-token');
    t.mock.method(sessions, 'resolveSessionFromTokens', async () => ({
      session: scenario === 'anonymous' || scenario === 'session-error' ? null : session,
      refreshed: scenario === 'refreshed',
      error: scenario === 'session-error' ? { message: 'Invalid session', status: 401, code: 'invalid_token' } : null,
    }));
    const requests: Array<{ path: string; method: string | undefined; authorization: string | null }> = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({ path: url.pathname + url.search, method: init?.method, authorization: new Headers(init?.headers).get('authorization') });
      return scenario === 'revocation-error'
        ? Response.json({ msg: 'Logout unavailable', error_code: 'logout_failed' }, { status: 400 })
        : new Response(null, { status: 204 });
    });
    t.mock.method(apiUtils, 'getAuthAdminClient', () => assert.fail('logout must not acquire a privileged client'));
    t.mock.method(apiUtils, 'getSystemAdminClient', () => assert.fail('logout must not acquire a system administrator'));
    const { POST } = require('../app/api/auth/route') as typeof import('../app/api/auth/route');
    const response = await POST(new NextRequest('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${sessions.ACCESS_COOKIE}=old-request-token; ${sessions.REFRESH_COOKIE}=fixture-refresh-token` },
      body: JSON.stringify({ action: 'signOut', token: 'untrusted-body-token' }),
    }));
    const rejected = scenario === 'session-error' || scenario === 'revocation-error';
    assert.equal(response.status, scenario === 'session-error' ? 401 : scenario === 'revocation-error' ? 400 : 200);
    assert.deepEqual(requests, scenario === 'anonymous' || scenario === 'session-error' ? [] : [{
      path: '/auth/v1/logout?scope=global', method: 'POST', authorization: `Bearer ${token}`,
    }]);
    const payload = await response.json();
    if (rejected) {
      assert.equal(payload.data, null);
      assert.equal(payload.error.code, scenario === 'session-error' ? 'invalid_token' : 'logout_failed');
      assert.equal(response.headers.get('set-cookie'), null, 'failed revocation must not be reported as a completed logout');
    } else {
      assert.deepEqual(payload, { data: { signedOut: true }, error: null });
      for (const name of [sessions.ACCESS_COOKIE, sessions.REFRESH_COOKIE]) {
        assert.equal(response.cookies.get(name)?.value, '');
        const expiry = response.cookies.get(name)?.expires;
        assert.equal(expiry instanceof Date ? expiry.getTime() : expiry, 0);
      }
    }
  });
}

// Timer grace and auth-event side effects are not exercised by SSR or the synthetic
// P5 SessionContext fixture, so retain their unique guards until runtime coverage exists.
test('ClientProviders should revalidate auth state and invalidate auth-bound queries after auth changes', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/providers/ClientProviders.tsx'), 'utf8');

  assert.match(source, /supabase\.auth\.revalidateSession\(\)/u);
  assert.match(source, /invalidateQueriesForPath\('\/api\/auth'\)/u);
});

test('/api/reminders GET should return 500 when reminder subscriptions cannot be loaded', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const remindersModule = require('../lib/reminders') as any;
  const routePath = require.resolve('../app/api/reminders/route');

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetReminderSubscriptions = remindersModule.getReminderSubscriptions;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: null,
  });
  remindersModule.getReminderSubscriptions = async () => {
    throw new remindersModule.ReminderReadError('获取提醒订阅失败');
  };

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    remindersModule.getReminderSubscriptions = originalGetReminderSubscriptions;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { GET } = require('../app/api/reminders/route') as typeof import('../app/api/reminders/route');
  const response = await GET(new NextRequest('http://localhost/api/reminders'));
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, '获取提醒订阅失败');
});

test('reminder account preconditions authenticate first, reject before read/write, and retain legacy compatibility', async (t) => {
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const reminders = require('../lib/reminders') as typeof import('../lib/reminders');
  const originalAuth = api.requireUserContext;
  const originalRead = reminders.getReminderSubscriptions;
  const originalWrite = reminders.updateReminderSubscription;
  const owners: string[] = [];
  reminders.getReminderSubscriptions = async owner => { owners.push(owner); return []; };
  reminders.updateReminderSubscription = async owner => { owners.push(owner); return true; };
  t.after(() => {
    api.requireUserContext = originalAuth;
    reminders.getReminderSubscriptions = originalRead;
    reminders.updateReminderSubscription = originalWrite;
  });
  const { GET, POST } = await import('../app/api/reminders/route');
  for (const authenticated of [false, true]) {
    api.requireUserContext = async () => authenticated
      ? { user: { id: 'alice' }, db: {} } as unknown as Awaited<ReturnType<typeof originalAuth>>
      : { error: { message: 'Unauthorized', status: 401 } };
    for (const [method, handler] of [['GET', GET], ['POST', POST]] as const) {
      for (const expected of [undefined, 'alice', 'bob', '']) {
        const before = owners.length;
        const response = await handler(new NextRequest('http://localhost/api/reminders', {
          method, headers: expected === undefined ? {} : { 'X-Expected-User-Id': expected },
          ...(method === 'POST' ? { body: JSON.stringify({ reminderType: 'fortune', enabled: false, user_id: 'bob' }) } : {}),
        }));
        const allowed = expected === undefined || expected === 'alice';
        assert.equal(response.status, !authenticated ? 401 : allowed ? 200 : 409);
        assert.equal(owners.length - before, authenticated && allowed ? 1 : 0);
      }
    }
  }
  assert.ok(owners.every(owner => owner === 'alice'));
});
