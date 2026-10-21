import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

import { createMockScopedDb } from './helpers/db-mock';

function mockAuthContext<T extends object>(user: unknown, db: T, scoped = createMockScopedDb()) {
  return {
    user,
    accessToken: null,
    authError: null,
    db,
    scoped,
    supabase: db,
  };
}

test('app bootstrap route should return viewer summary, membership, toggles and unread count', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const appSettingsModule = require('../lib/app-settings') as any;
  const routePath = require.resolve('../app/api/app/bootstrap/route');

  const originalGetAuthContext = apiUtilsModule.getAuthContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalReadFeatureTogglesState = appSettingsModule.readFeatureTogglesState;

  apiUtilsModule.getAuthContext = async () => mockAuthContext(
    {
      id: 'user-1',
      user_metadata: {
        nickname: '回退昵称',
        avatar_url: 'https://example.com/avatar.png',
      },
    },
    {
      from(table: string) {
        if (table === 'users') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        id: 'user-1',
                        nickname: '正式昵称',
                        avatar_url: 'https://example.com/formal-avatar.png',
                        is_admin: true,
                        membership: 'pro',
                        membership_expires_at: '2099-01-01T00:00:00.000Z',
                        ai_chat_count: 88,
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }

        if (table === 'notifications') {
          return {
            select() {
              return {
                eq() {
                  return {
                    gte() {
                      return {
                        eq: async () => ({
                          count: 4,
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`unexpected table: ${table}`);
      },
    },
  );
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: { chat: false, tarot: true } });

  t.after(() => {
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    appSettingsModule.readFeatureTogglesState = originalReadFeatureTogglesState;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/app/bootstrap/route') as typeof import('../app/api/app/bootstrap/route');
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
});

test('app bootstrap route should return public state for anonymous users', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const appSettingsModule = require('../lib/app-settings') as any;
  const routePath = require.resolve('../app/api/app/bootstrap/route');

  const originalGetAuthContext = apiUtilsModule.getAuthContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalReadFeatureTogglesState = appSettingsModule.readFeatureTogglesState;

  apiUtilsModule.getAuthContext = async () => mockAuthContext(null, {});
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: { chat: false } });

  t.after(() => {
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    appSettingsModule.readFeatureTogglesState = originalReadFeatureTogglesState;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/app/bootstrap/route') as typeof import('../app/api/app/bootstrap/route');
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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const appSettingsModule = require('../lib/app-settings') as any;
  const routePath = require.resolve('../app/api/app/bootstrap/route');

  const originalGetAuthContext = apiUtilsModule.getAuthContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalReadFeatureTogglesState = appSettingsModule.readFeatureTogglesState;

  apiUtilsModule.getAuthContext = async () => mockAuthContext(null, {});
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: false, toggles: {} });

  t.after(() => {
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    appSettingsModule.readFeatureTogglesState = originalReadFeatureTogglesState;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/app/bootstrap/route') as typeof import('../app/api/app/bootstrap/route');
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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const appSettingsModule = require('../lib/app-settings') as any;
  const routePath = require.resolve('../app/api/app/bootstrap/route');

  const originalGetAuthContext = apiUtilsModule.getAuthContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalReadFeatureTogglesState = appSettingsModule.readFeatureTogglesState;

  apiUtilsModule.getAuthContext = async () => mockAuthContext(
    {
      id: 'user-1',
      user_metadata: {
        nickname: '回退昵称',
      },
    },
    {
      from(table: string) {
        if (table === 'users') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: null,
                      error: { message: 'boom' },
                    }),
                  };
                },
              };
            },
          };
        }

        if (table === 'notifications') {
          return {
            select() {
              return {
                eq() {
                  return {
                    gte() {
                      return {
                        eq: async () => ({
                          count: 2,
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`unexpected table: ${table}`);
      },
    },
  );
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: { chat: false } });

  t.after(() => {
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    appSettingsModule.readFeatureTogglesState = originalReadFeatureTogglesState;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/app/bootstrap/route') as typeof import('../app/api/app/bootstrap/route');
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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const appSettingsModule = require('../lib/app-settings') as any;
  const routePath = require.resolve('../app/api/app/bootstrap/route');

  const originalGetAuthContext = apiUtilsModule.getAuthContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalReadFeatureTogglesState = appSettingsModule.readFeatureTogglesState;

  apiUtilsModule.getAuthContext = async () => mockAuthContext(
    {
      id: 'user-1',
      user_metadata: {
        nickname: '回退昵称',
        avatar_url: 'https://example.com/avatar.png',
      },
    },
    {
      from(table: string) {
        if (table === 'users') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: null,
                      error: null,
                    }),
                  };
                },
              };
            },
            upsert() {
              return Promise.resolve({
                error: { message: 'upsert failed' },
              });
            },
          };
        }

        if (table === 'notifications') {
          return {
            select() {
              return {
                eq() {
                  return {
                    gte() {
                      return {
                        eq: async () => ({
                          count: 0,
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`unexpected table: ${table}`);
      },
    },
  );
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: { chat: false } });

  t.after(() => {
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    appSettingsModule.readFeatureTogglesState = originalReadFeatureTogglesState;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/app/bootstrap/route') as typeof import('../app/api/app/bootstrap/route');
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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const appSettingsModule = require('../lib/app-settings') as any;
  const routePath = require.resolve('../app/api/app/bootstrap/route');

  const originalGetAuthContext = apiUtilsModule.getAuthContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalReadFeatureTogglesState = appSettingsModule.readFeatureTogglesState;

  let ensured = false;
  let lookupCount = 0;

  apiUtilsModule.getAuthContext = async () => mockAuthContext(
    {
      id: 'user-1',
      user_metadata: {
        nickname: '补建昵称',
      },
    },
    {
      from(table: string) {
        if (table === 'users') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => {
                      lookupCount += 1;
                      if (!ensured) {
                        return { data: null, error: null };
                      }
                      return {
                        data: {
                          id: 'user-1',
                          nickname: '补建昵称',
                          avatar_url: null,
                          is_admin: false,
                          membership: 'free',
                          membership_expires_at: null,
                          ai_chat_count: 1,
                        },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === 'notifications') {
          return {
            select() {
              return {
                eq() {
                  return {
                    gte() {
                      return {
                        eq: async () => ({
                          count: 0,
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`unexpected table: ${table}`);
      },
    },
    createMockScopedDb({
      tx: async (work) => work({
        insertInto: () => ({
          values: (seed: Record<string, unknown>) => {
            assert.equal(seed.nickname, '补建昵称');
            ensured = true;
            return { onConflict: () => ({ execute: async () => undefined }) };
          },
        }),
      } as never),
    }),
  );
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: { chat: false } });

  t.after(() => {
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    appSettingsModule.readFeatureTogglesState = originalReadFeatureTogglesState;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/app/bootstrap/route') as typeof import('../app/api/app/bootstrap/route');
  const response = await routeModule.GET(new NextRequest('http://localhost/api/app/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(ensured, true);
  assert.equal(lookupCount, 2);
  assert.equal(payload.data.viewerLoaded, true);
  assert.equal(payload.data.viewerSummary.nickname, '补建昵称');
  assert.equal(payload.data.viewerErrorMessage, null);
});

test('app bootstrap route should downgrade expired viewer membership to free consistently', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const appSettingsModule = require('../lib/app-settings') as any;
  const routePath = require.resolve('../app/api/app/bootstrap/route');

  const originalGetAuthContext = apiUtilsModule.getAuthContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalReadFeatureTogglesState = appSettingsModule.readFeatureTogglesState;

  apiUtilsModule.getAuthContext = async () => mockAuthContext(
    {
      id: 'user-1',
      user_metadata: {},
    },
    {
      from(table: string) {
        if (table === 'users') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        id: 'user-1',
                        nickname: '过期用户',
                        avatar_url: null,
                        is_admin: false,
                        membership: 'pro',
                        membership_expires_at: '2020-01-01T00:00:00.000Z',
                        ai_chat_count: 7,
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }

        if (table === 'notifications') {
          return {
            select() {
              return {
                eq() {
                  return {
                    gte() {
                      return {
                        eq: async () => ({
                          count: 0,
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`unexpected table: ${table}`);
      },
    },
  );
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  appSettingsModule.readFeatureTogglesState = async () => ({ loaded: true, toggles: {} });

  t.after(() => {
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    appSettingsModule.readFeatureTogglesState = originalReadFeatureTogglesState;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/app/bootstrap/route') as typeof import('../app/api/app/bootstrap/route');
  const response = await routeModule.GET(new NextRequest('http://localhost/api/app/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.membership.type, 'free');
  assert.equal(payload.data.membership.isActive, false);
  assert.equal(payload.data.viewerSummary.membershipType, 'free');
  assert.equal(payload.data.viewerSummary.aiChatCount, 7);
  assert.equal(payload.data.viewerSummary.membershipExpiresAt, null);
});

test('loadAppBootstrap should unwrap the route envelope into app bootstrap data', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => new Response(JSON.stringify({
    data: {
      viewerLoaded: true,
      viewerSummary: {
        userId: 'user-1',
        nickname: '缓存用户',
        avatarUrl: null,
        isAdmin: false,
        membershipType: 'free',
        membershipExpiresAt: null,
        aiChatCount: 1,
      },
      viewerErrorMessage: null,
      membership: {
        type: 'free',
        expiresAt: null,
        isActive: true,
        aiChatCount: 1,
      },
      featureToggles: { chat: false },
      featureTogglesLoaded: true,
      featureTogglesErrorMessage: null,
      unreadCount: 7,
      unreadCountLoaded: true,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }) as Response;

  try {
    const { loadAppBootstrap } = await import('../lib/app/bootstrap');
    const payload = await loadAppBootstrap();

    assert.equal(payload.viewerSummary?.userId, 'user-1');
    assert.equal(payload.featureToggles.chat, false);
    assert.equal(payload.unreadCount, 7);
  } finally {
    global.fetch = originalFetch;
  }
});

test('loadAppBootstrap should throw on request failure', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => new Response(JSON.stringify({ error: 'boom' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  }) as Response;

  try {
    const { loadAppBootstrap } = await import('../lib/app/bootstrap');
    await assert.rejects(() => loadAppBootstrap(), /boom/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test('loadAppBootstrap should preserve viewer data when feature state is unavailable', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => new Response(JSON.stringify({
    data: {
      viewerLoaded: true,
      viewerSummary: null,
      viewerErrorMessage: null,
      membership: null,
      featureToggles: {},
      featureTogglesLoaded: false,
      featureTogglesErrorMessage: '功能状态加载失败',
      unreadCount: 0,
      unreadCountLoaded: true,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }) as Response;

  try {
    const { loadAppBootstrap } = await import('../lib/app/bootstrap');
    const payload = await loadAppBootstrap();
    assert.equal(payload.featureTogglesLoaded, false);
    assert.equal(payload.featureTogglesErrorMessage, '功能状态加载失败');
  } finally {
    global.fetch = originalFetch;
  }
});
