import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';


import { createMockScopedDb } from './helpers/db-mock';

type ProfileRow = Record<string, unknown> | null;

type ViewerScopedOptions = {
  profile?: ProfileRow;
  /** Per-read profile sequence (falls back to `profile` after the list is exhausted). */
  profileReads?: ProfileRow[];
  profileError?: unknown;
  unread?: number;
  unreadError?: unknown;
  insertFails?: boolean;
  onInsert?: (seed: Record<string, unknown>) => void;
};

function viewerScoped(options: ViewerScopedOptions = {}) {
  let reads = 0;
  let inserted = false;
  const db = createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        const query = {
          select() { return query; },
          where() { return query; },
          limit() { return query; },
          orderBy() { return query; },
          async executeTakeFirst() {
            if (table === 'users') {
              if (options.profileError) throw options.profileError;
              reads += 1;
              if (options.profileReads) {
                return options.profileReads[Math.min(reads - 1, options.profileReads.length - 1)];
              }
              return options.profile ?? null;
            }
            if (table === 'notifications') {
              if (options.unreadError) throw options.unreadError;
              return { count: options.unread ?? 0 };
            }
            throw new Error(`unexpected table: ${table}`);
          },
          async execute() {
            throw new Error(`unexpected execute on table: ${table}`);
          },
        };
        return query;
      },
      insertInto(table: string) {
        assert.equal(table, 'users');
        return {
          values(seed: Record<string, unknown>) {
            options.onInsert?.(seed);
            return {
              onConflict: () => ({
                execute: async () => {
                  if (options.insertFails) throw new Error('upsert failed');
                  inserted = true;
                },
              }),
            };
          },
        };
      },
    } as never),
  });
  return { db, inserts: () => inserted, reads: () => reads };
}

function mockAuthContext(user: unknown, db = createMockScopedDb()) {
  return {
    user,
    authError: null,
    db,
  };
}

function installRoute(t: import('node:test').TestContext, authContext: () => Promise<ReturnType<typeof mockAuthContext>>) {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const appSettingsModule = require('../lib/app-settings') as any;
  const routePath = require.resolve('../app/api/app/bootstrap/route');

  const originalGetAuthContext = apiUtilsModule.getAuthContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalReadFeatureTogglesState = appSettingsModule.readFeatureTogglesState;

  apiUtilsModule.getAuthContext = authContext;
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });

  t.after(() => {
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    appSettingsModule.readFeatureTogglesState = originalReadFeatureTogglesState;
    delete require.cache[routePath];
  });
  delete require.cache[routePath];
  return {
    appSettingsModule,
    routeModule: require('../app/api/app/bootstrap/route') as typeof import('../app/api/app/bootstrap/route'),
  };
}

test('app bootstrap route should return viewer summary, membership, toggles and unread count', async (t) => {
  const scoped = viewerScoped({
    profile: {
      id: 'user-1',
      nickname: '正式昵称',
      avatar_url: 'https://example.com/formal-avatar.png',
      is_admin: true,
      membership: 'pro',
      membership_expires_at: '2099-01-01T00:00:00.000Z',
      ai_chat_count: 88,
    },
    unread: 4,
  });
  const { appSettingsModule, routeModule } = installRoute(t, async () => mockAuthContext(
    { id: 'user-1', user_metadata: { nickname: '回退昵称', avatar_url: 'https://example.com/avatar.png' } },
    scoped.db,
  ));
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: { chat: false, tarot: true } });

  const response = await routeModule.GET(new NextRequest('http://localhost/api/app/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.viewerLoaded, true);
  assert.equal(payload.data.viewerSummary.userId, 'user-1');
  assert.equal(payload.data.viewerSummary.nickname, '正式昵称');
  assert.equal(payload.data.viewerSummary.isAdmin, true);
  assert.equal(payload.data.viewerErrorMessage, null);
  assert.equal(payload.data.membership.type, 'pro');
  assert.equal(payload.data.membership.aiChatCount, 88);
  assert.equal(payload.data.featureToggles.chat, false);
  assert.equal(payload.data.featureTogglesLoaded, true);
  assert.equal(payload.data.featureTogglesErrorMessage, null);
  assert.equal(payload.data.unreadCount, 4);
  assert.equal(payload.data.unreadCountLoaded, true);
  assert.equal(scoped.reads(), 1);
});

test('app bootstrap route should return public state for anonymous users', async (t) => {
  const { appSettingsModule, routeModule } = installRoute(t, async () => mockAuthContext(null));
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: { chat: false } });

  const response = await routeModule.GET(new NextRequest('http://localhost/api/app/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.viewerLoaded, true);
  assert.equal(payload.data.viewerSummary, null);
  assert.equal(payload.data.viewerErrorMessage, null);
  assert.equal(payload.data.membership, null);
  assert.equal(payload.data.featureToggles.chat, false);
  assert.equal(payload.data.featureTogglesLoaded, true);
  assert.equal(payload.data.featureTogglesErrorMessage, null);
  assert.equal(payload.data.unreadCount, 0);
  assert.equal(payload.data.unreadCountLoaded, true);
});

test('app bootstrap route should mark toggles as unloaded when app settings reads fail', async (t) => {
  const { appSettingsModule, routeModule } = installRoute(t, async () => mockAuthContext(null));
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: false, toggles: {} });

  const response = await routeModule.GET(new NextRequest('http://localhost/api/app/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 207);
  assert.equal(payload.data.viewerLoaded, true);
  assert.deepEqual(payload.data.featureToggles, {});
  assert.equal(payload.data.featureTogglesLoaded, false);
  assert.equal(payload.data.featureTogglesErrorMessage, '功能状态加载失败');
  assert.equal(payload.data.unreadCountLoaded, true);
});

test('app bootstrap route should mark viewer state as unloaded when profile lookup fails', async (t) => {
  const scoped = viewerScoped({ profileError: new Error('boom'), unread: 2 });
  const { appSettingsModule, routeModule } = installRoute(t, async () => mockAuthContext(
    { id: 'user-1', user_metadata: { nickname: '回退昵称' } },
    scoped.db,
  ));
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: { chat: false } });

  const response = await routeModule.GET(new NextRequest('http://localhost/api/app/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 207);
  assert.equal(payload.data.viewerLoaded, false);
  assert.equal(payload.data.viewerSummary, null);
  assert.equal(payload.data.viewerErrorMessage, '加载账户状态失败');
  assert.equal(payload.data.membership, null);
  assert.equal(payload.data.unreadCount, 2);
  assert.equal(payload.data.unreadCountLoaded, true);
});

test('app bootstrap route should keep viewer state unloaded when user-row recovery fails', async (t) => {
  const scoped = viewerScoped({ profile: null, insertFails: true, unread: 0 });
  const { appSettingsModule, routeModule } = installRoute(t, async () => mockAuthContext(
    { id: 'user-1', user_metadata: { nickname: '回退昵称', avatar_url: 'https://example.com/avatar.png' } },
    scoped.db,
  ));
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: { chat: false } });

  const response = await routeModule.GET(new NextRequest('http://localhost/api/app/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 207);
  assert.equal(payload.data.viewerLoaded, false);
  assert.equal(payload.data.viewerSummary, null);
  assert.equal(payload.data.viewerErrorMessage, '加载账户状态失败');
  assert.equal(payload.data.membership, null);
  assert.equal(payload.data.unreadCountLoaded, true);
});

test('app bootstrap route should recover a missing user row before returning viewer state', async (t) => {
  let seededNickname: unknown;
  const scoped = viewerScoped({
    profileReads: [null, {
      id: 'user-1',
      nickname: '补建昵称',
      avatar_url: null,
      is_admin: false,
      membership: 'free',
      membership_expires_at: null,
      ai_chat_count: 1,
    }],
    unread: 0,
    onInsert: (seed) => { seededNickname = seed.nickname; },
  });
  const { appSettingsModule, routeModule } = installRoute(t, async () => mockAuthContext(
    { id: 'user-1', name: '补建昵称', image: null },
    scoped.db,
  ));
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: { chat: false } });

  const response = await routeModule.GET(new NextRequest('http://localhost/api/app/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(seededNickname, '补建昵称');
  assert.equal(scoped.inserts(), true);
  assert.equal(scoped.reads(), 2);
  assert.equal(payload.data.viewerLoaded, true);
  assert.equal(payload.data.viewerSummary.nickname, '补建昵称');
  assert.equal(payload.data.viewerErrorMessage, null);
});

test('app bootstrap route should downgrade expired viewer membership to free consistently', async (t) => {
  const scoped = viewerScoped({
    profile: {
      id: 'user-1',
      nickname: '过期用户',
      avatar_url: null,
      is_admin: false,
      membership: 'pro',
      membership_expires_at: '2020-01-01T00:00:00.000Z',
      ai_chat_count: 7,
    },
    unread: 0,
  });
  const { appSettingsModule, routeModule } = installRoute(t, async () => mockAuthContext(
    { id: 'user-1', user_metadata: {} },
    scoped.db,
  ));
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: {} });

  const response = await routeModule.GET(new NextRequest('http://localhost/api/app/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.membership.type, 'free');
  assert.equal(payload.data.membership.isActive, false);
  assert.equal(payload.data.viewerSummary.membershipType, 'free');
  assert.equal(payload.data.viewerSummary.aiChatCount, 7);
  assert.equal(payload.data.viewerSummary.membershipExpiresAt, null);
});
