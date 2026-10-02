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
