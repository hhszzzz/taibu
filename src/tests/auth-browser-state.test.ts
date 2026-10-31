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
import { createMockAuthContext } from './helpers/auth-mock';
import { createMockScopedDb } from './helpers/db-mock';

type BootstrapSnapshot = ReturnType<typeof import('../lib/hooks/useAppBootstrap').useAppBootstrap>;

function bootstrapSnapshot(data: AppBootstrapData, state: Pick<BootstrapSnapshot, 'hasBootstrapData' | 'viewerStateLoaded' | 'viewerStateResolved'>): BootstrapSnapshot {
  const client = new QueryClient();
  const result = new QueryObserver(client, { queryKey: ['hook-fixture'], queryFn: async () => data, enabled: false }).getCurrentResult();
  client.clear();
  return { ...result, data, ...state, viewerStateError: null, refresh: async () => data, markBalanceExhausted() {} };
}

function userFor(id: string) {
  return {
    id: `user-${id}`,
    email: `user-${id}@example.test`,
    emailVerified: true,
    name: '测试用户',
    image: null,
  };
}

function sessionFor(id: string) {
  const user = userFor(id);
  return { id: `session-${id}`, userId: user.id, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
}

test('browser session cache deduplicates reads, invalidates, and revalidates with events', async (t) => {
  const auth = require('../lib/auth') as typeof import('../lib/auth');
  let calls = 0;
  const previous = auth.__setAuthClientForTests({
    getSession: async () => {
      calls += 1;
      const key = String(calls);
      return { data: { session: sessionFor(key), user: userFor(key) }, error: null };
    },
  } as unknown as Parameters<typeof auth.__setAuthClientForTests>[0]);
  t.after(() => { auth.__setAuthClientForTests(previous); });

  auth.invalidateBrowserSessionCache();
  const first = await auth.getSessionSnapshot();
  const second = await auth.getSessionSnapshot();
  auth.invalidateBrowserSessionCache();
  const third = await auth.getSessionSnapshot();

  const events: Array<{ event: string; userId: string | null }> = [];
  const unsubscribe = auth.subscribeToAuth((event, state) => {
    events.push({ event, userId: state.user?.id ?? null });
  });
  await new Promise((resolve) => setImmediate(resolve));
  const fourth = await auth.revalidateBrowserSession();
  unsubscribe();

  assert.equal(first.data.user?.id, 'user-1');
  assert.equal(second.data.user?.id, 'user-1');
  assert.equal(third.data.user?.id, 'user-2');
  assert.equal(fourth.data.user?.id, 'user-3');
  assert.equal(calls, 3);
  assert.deepEqual(events, [
    { event: 'initial', userId: 'user-2' },
    { event: 'token-refreshed', userId: 'user-3' },
  ]);
});

test('signInWithEmail maps Better Auth codes to the historical Chinese messages', async (t) => {
  const auth = require('../lib/auth') as typeof import('../lib/auth');
  const previous = auth.__setAuthClientForTests({
    signIn: {
      email: async () => ({
        data: null,
        error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'invalid credentials' },
      }),
    },
  } as unknown as Parameters<typeof auth.__setAuthClientForTests>[0]);
  t.after(() => { auth.__setAuthClientForTests(previous); });

  const result = await auth.signInWithEmail('user@example.test', 'wrong-password');

  assert.deepEqual(result, {
    success: false,
    error: { message: '邮箱或密码错误', code: 'INVALID_EMAIL_OR_PASSWORD' },
  });
});

test('signUpWithEmail surfaces password policy and duplicate-account errors', async (t) => {
  const auth = require('../lib/auth') as typeof import('../lib/auth');
  const responses = [
    { code: 'PASSWORD_TOO_SHORT', message: 'too short' },
    { code: 'USER_ALREADY_EXISTS', message: 'exists' },
  ];
  const previous = auth.__setAuthClientForTests({
    signUp: {
      email: async () => ({ data: null, error: responses.shift() }),
    },
  } as unknown as Parameters<typeof auth.__setAuthClientForTests>[0]);
  t.after(() => { auth.__setAuthClientForTests(previous); });

  const short = await auth.signUpWithEmail('user@example.test', 'short');
  const duplicate = await auth.signUpWithEmail('user@example.test', 'long-enough-password');

  assert.equal(short.error?.message, '密码至少8个字符');
  assert.equal(duplicate.error?.message, '该邮箱已注册');
});

test('sendOTP maps OTP rate limiting to a retry message', async (t) => {
  const auth = require('../lib/auth') as typeof import('../lib/auth');
  const previous = auth.__setAuthClientForTests({
    emailOtp: {
      sendVerificationOtp: async () => ({
        data: null,
        error: { code: 'TOO_MANY_ATTEMPTS', message: 'slow down' },
      }),
    },
  } as unknown as Parameters<typeof auth.__setAuthClientForTests>[0]);
  t.after(() => { auth.__setAuthClientForTests(previous); });

  const result = await auth.sendOTP('user@example.test', 'magiclink');

  assert.equal(result.success, false);
  assert.equal(result.error?.message, '请求过于频繁，请稍后再试');
});

test('signOut clears the cached session and emits signed-out', async (t) => {
  const auth = require('../lib/auth') as typeof import('../lib/auth');
  const previous = auth.__setAuthClientForTests({
    getSession: async () => {
      return { data: { session: sessionFor('1'), user: userFor('1') }, error: null };
    },
    signOut: async () => ({ data: { success: true }, error: null }),
  } as unknown as Parameters<typeof auth.__setAuthClientForTests>[0]);
  t.after(() => { auth.__setAuthClientForTests(previous); });

  auth.invalidateBrowserSessionCache();
  assert.equal((await auth.getSessionSnapshot()).data.user?.id, 'user-1');
  const events: string[] = [];
  const unsubscribe = auth.subscribeToAuth((event) => { events.push(event); });
  await new Promise((resolve) => setImmediate(resolve));

  const result = await auth.signOut();
  unsubscribe();

  assert.deepEqual(result, { success: true });
  assert.deepEqual(events, ['initial', 'signed-out']);
  assert.equal((await auth.getSessionSnapshot()).data.session, null);
});

test('an unverified password sign-in verifies the mailbox instead of sending a sign-in code', () => {
  // P1-1: Better Auth revokes every account, password included, when a sign-in
  // OTP promotes an unverified user; this flow must use email verification.
  const source = readFileSync(resolve(process.cwd(), 'src/components/auth/AuthModal.tsx'), 'utf8');
  // The address is trimmed once (`normalizedEmail`) and every auth call sends that value.
  assert.match(source, /const normalizedEmail = normalizeAuthEmail\(email\);/u);
  assert.match(source, /EMAIL_NOT_VERIFIED[\s\S]{0,400}sendOTP\(normalizedEmail, 'signup'\)/u);
  assert.match(source, /verifyPurpose === 'verify-email'[\s\S]{0,400}verifyOTP\(normalizedEmail, codeToVerify, 'signup'\)/u);
  assert.match(source, /verifyPurpose === 'verify-email'[\s\S]{0,900}signInWithEmail\(normalizedEmail, password\)/u);
  assert.doesNotMatch(source, /USER_ALREADY_EXISTS/u);
});

test('useAppBootstrap should defer viewer failures briefly before surfacing them', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/hooks/useAppBootstrap.ts'), 'utf8');

  assert.match(source, /const VIEWER_STATE_ERROR_GRACE_MS = 3_000;/u);
  assert.match(source, /const VIEWER_STATE_RETRY_INTERVAL_MS = 800;/u);
  assert.match(source, /if \(viewerPendingKey && !viewerFailureTimedOut\)/u);
});

test('session balance distinguishes anonymous, pending, failed, loaded and refreshing viewer states', async (t) => {
  const bootstrapModule = require('../lib/hooks/useAppBootstrap') as typeof import('../lib/hooks/useAppBootstrap');
  const { useSessionBalance } = require('../lib/hooks/useSessionBalance') as typeof import('../lib/hooks/useSessionBalance');
  const user = createMockAuthContext('user-1').user;
  const billing = { walletMicros: 1_500_000, subscriptionMicros: 250_000, spendableMicros: 1_750_000 };
  const cases = [
    { name: 'anonymous', user: null, sessionLoading: false, loaded: false, resolved: false, expectedResolved: true, expectedLoading: false },
    { name: 'initial session', user: null, sessionLoading: true, loaded: false, resolved: false, expectedResolved: true, expectedLoading: true },
    { name: 'pending viewer failure grace', user, sessionLoading: false, loaded: false, resolved: false, expectedResolved: false, expectedLoading: true },
    { name: 'settled viewer failure', user, sessionLoading: false, loaded: false, resolved: true, expectedResolved: true, expectedLoading: false },
    { name: 'loaded balance', user, sessionLoading: false, loaded: true, resolved: true, expectedResolved: true, expectedLoading: false },
    { name: 'session refreshing', user, sessionLoading: true, loaded: true, resolved: true, expectedResolved: true, expectedLoading: true },
  ];
  let snapshot = bootstrapSnapshot(EMPTY_APP_BOOTSTRAP, { hasBootstrapData: false, viewerStateLoaded: false, viewerStateResolved: false });
  t.mock.method(bootstrapModule, 'useAppBootstrap', () => snapshot);
  const observed: ReturnType<typeof useSessionBalance>[] = [];
  function Probe() { observed.push(useSessionBalance()); return null; }

  for (const scenario of cases) {
    snapshot = bootstrapSnapshot({ ...EMPTY_APP_BOOTSTRAP, viewerLoaded: scenario.loaded, billing }, {
      hasBootstrapData: true, viewerStateLoaded: scenario.loaded, viewerStateResolved: scenario.resolved,
    });
    renderToStaticMarkup(React.createElement(SessionContext.Provider, {
      value: { session: null, user: scenario.user, loading: scenario.sessionLoading },
    }, React.createElement(Probe)));
    const actual = observed.pop();
    assert.ok(actual, scenario.name);
    assert.equal(actual.user, scenario.user, scenario.name);
    assert.equal(actual.balanceResolved, scenario.expectedResolved, scenario.name);
    assert.equal(actual.balanceLoading, scenario.expectedLoading, scenario.name);
    assert.equal(actual.balance, scenario.loaded ? billing : null, scenario.name);
    assert.equal(await actual.refreshBalance(), scenario.loaded ? billing : null, scenario.name);
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

test('ClientProviders should revalidate auth state and invalidate auth-bound queries after auth changes', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/providers/ClientProviders.tsx'), 'utf8');

  assert.match(source, /revalidateBrowserSession\(\)/u);
  assert.match(source, /subscribeToAuth\(/u);
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
    db: createMockScopedDb(),
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
      ? { user: { id: 'alice' }, db: createMockScopedDb() } as unknown as Awaited<ReturnType<typeof originalAuth>>
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
