import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

import { createMockScopedDb } from './helpers/db-mock';

function mockUserContext<T extends object>(user: unknown, db: T, scoped = createMockScopedDb()) {
  return {
    user,
    accessToken: null,
    db,
    scoped,
    supabase: db,
  };
}

test('user profile route should update profile fields and return the normalized settings bundle', async (t) => {
  const apiUtilsPath = require.resolve('../lib/api-utils');
  const routePath = require.resolve('../app/api/user/profile/route');
  const apiUtilsModule = require('../lib/api-utils');

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalJsonError = apiUtilsModule.jsonError;

  const calls: Array<{ table: string; action: string; payload?: Record<string, unknown> }> = [];

  const makeUsersQuery = (nickname = '命理爱好者') => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: async () => ({
      data: {
        id: 'user-1',
        nickname,
        avatar_url: null,
        is_admin: false,
        membership: 'free',
        membership_expires_at: null,
        ai_chat_count: 1,
      },
      error: null,
    }),
  });

  const fakeSupabase = {
    from(table: string) {
      if (table === 'users') {
        return {
          ...makeUsersQuery(),
          update(payload: Record<string, unknown>) {
            calls.push({ table, action: 'update', payload });
            return makeUsersQuery(String(payload.nickname ?? '命理爱好者'));
          },
        };
      }

      if (table === 'user_settings') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: {
              expression_style: 'gentle',
              custom_instructions: 'keep calm',
              user_profile: { identity: 'tester' },
              prompt_kb_ids: ['kb-1'],
            },
            error: null,
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  apiUtilsModule.requireUserContext = async () => mockUserContext(
    { id: 'user-1' },
    fakeSupabase,
    createMockScopedDb({
      tx: async (work) => work({
        selectFrom: () => ({
          select: () => ({
            where: () => ({
              executeTakeFirst: async () => ({
                expression_style: 'gentle',
                custom_instructions: 'keep calm',
                user_profile: { identity: 'tester' },
                prompt_kb_ids: ['kb-1'],
              }),
            }),
          }),
        }),
      } as never),
    }),
  );
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  apiUtilsModule.jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    apiUtilsModule.jsonError = originalJsonError;
    delete require.cache[routePath];
    delete require.cache[apiUtilsPath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/user/profile/route') as typeof import('../app/api/user/profile/route');

  const response = await routeModule.PATCH(new Request('http://localhost/api/user/profile', {
    method: 'PATCH',
    body: JSON.stringify({
      profile: {
        nickname: '新昵称',
      },
    }),
    headers: { 'Content-Type': 'application/json' },
  }) as never);

  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.table, 'users');
  assert.equal(calls[0]?.action, 'update');
  assert.equal(calls[0]?.payload?.nickname, '新昵称');
  assert.equal(payload.profile?.nickname, '新昵称');
  assert.equal(payload.settings?.expressionStyle, 'gentle');
  assert.deepEqual(payload.settings?.promptKbIds, ['kb-1']);
});

test('user profile route should downgrade expired membership to free in profile responses', async (t) => {
  const apiUtilsPath = require.resolve('../lib/api-utils');
  const routePath = require.resolve('../app/api/user/profile/route');
  const apiUtilsModule = require('../lib/api-utils');

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalJsonError = apiUtilsModule.jsonError;

  apiUtilsModule.requireUserContext = async () => mockUserContext(
    { id: 'user-1' },
    {
      from(table: string) {
        if (table === 'users') {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            maybeSingle: async () => ({
              data: {
                id: 'user-1',
                nickname: '过期会员',
                avatar_url: null,
                is_admin: false,
                membership: 'pro',
                membership_expires_at: '2020-01-01T00:00:00.000Z',
                ai_chat_count: 7,
              },
              error: null,
            }),
          };
        }

        if (table === 'user_settings') {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            maybeSingle: async () => ({
              data: null,
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
  );
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  apiUtilsModule.jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    apiUtilsModule.jsonError = originalJsonError;
    delete require.cache[routePath];
    delete require.cache[apiUtilsPath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/user/profile/route') as typeof import('../app/api/user/profile/route');
  const response = await routeModule.GET(new Request('http://localhost/api/user/profile?scope=profile') as never);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.profile?.membership, 'free');
  assert.equal(payload.profile?.membership_expires_at, null);
  assert.equal(payload.profile?.ai_chat_count, 7);
});

test('user profile route should recover a missing user row before returning profile data', async (t) => {
  const apiUtilsPath = require.resolve('../lib/api-utils');
  const routePath = require.resolve('../app/api/user/profile/route');
  const apiUtilsModule = require('../lib/api-utils');

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalJsonError = apiUtilsModule.jsonError;

  let ensured = false;
  let userLookupCount = 0;

  apiUtilsModule.requireUserContext = async () => mockUserContext(
    {
      id: 'user-1',
      user_metadata: {
        nickname: '补建资料',
      },
    },
    {
      from(table: string) {
        if (table === 'users') {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            maybeSingle: async () => {
              userLookupCount += 1;
              if (!ensured) {
                return {
                  data: null,
                  error: null,
                };
              }

              return {
                data: {
                  id: 'user-1',
                  nickname: '补建资料',
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
        }

        if (table === 'user_settings') {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            maybeSingle: async () => ({
              data: null,
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
    createMockScopedDb({
      tx: async (work) => work({
        insertInto: () => ({
          values: (seed: Record<string, unknown>) => {
            assert.equal(seed.nickname, '补建资料');
            ensured = true;
            return { onConflict: () => ({ execute: async () => undefined }) };
          },
        }),
      } as never),
    }),
  );
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  apiUtilsModule.jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    apiUtilsModule.jsonError = originalJsonError;
    delete require.cache[routePath];
    delete require.cache[apiUtilsPath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/user/profile/route') as typeof import('../app/api/user/profile/route');
  const response = await routeModule.GET(new Request('http://localhost/api/user/profile?scope=profile') as never);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(ensured, true);
  assert.equal(userLookupCount, 2);
  assert.equal(payload.profile?.nickname, '补建资料');
});
