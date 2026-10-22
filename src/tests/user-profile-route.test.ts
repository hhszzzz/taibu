import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

import { createMockScopedDb } from './helpers/db-mock';

type Row = Record<string, unknown> | null;

function mockUserContext(user: unknown, db = createMockScopedDb()) {
  return {
    user,
    accessToken: null,
    authError: null,
    db,
  };
}

type ProfileScopedOptions = {
  selectUsers: () => Promise<Row> | Row;
  updateUsers?: (payload: Record<string, unknown>) => Promise<Row> | Row;
  selectSettings?: () => Promise<Row> | Row;
  onInsert?: (seed: Record<string, unknown>) => void;
};

function profileScoped(options: ProfileScopedOptions) {
  return createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        const query = {
          select() { return query; },
          where() { return query; },
          async executeTakeFirst() {
            if (table === 'users') return options.selectUsers();
            if (table === 'user_settings') return options.selectSettings ? options.selectSettings() : null;
            throw new Error(`unexpected table: ${table}`);
          },
        };
        return query;
      },
      updateTable(table: string) {
        assert.equal(table, 'users');
        return {
          set(payload: Record<string, unknown>) {
            return {
              where() {
                return {
                  returning() {
                    return {
                      async executeTakeFirst() {
                        return options.updateUsers ? options.updateUsers(payload) : null;
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
      insertInto(table: string) {
        assert.equal(table, 'users');
        return {
          values(seed: Record<string, unknown>) {
            options.onInsert?.(seed);
            return {
              onConflict: () => ({ execute: async () => undefined }),
            };
          },
        };
      },
    } as never),
  });
}

const BASE_ROW: Record<string, unknown> = {
  id: 'user-1',
  nickname: '命理爱好者',
  avatar_url: null,
  is_admin: false,
  membership: 'free',
  membership_expires_at: null,
  ai_chat_count: 1,
};

function installRoute(t: import('node:test').TestContext, scoped: ReturnType<typeof createMockScopedDb>, user: unknown = { id: 'user-1' }) {
  const apiUtilsPath = require.resolve('../lib/api-utils');
  const routePath = require.resolve('../app/api/user/profile/route');
  const apiUtilsModule = require('../lib/api-utils') as any;

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
    delete require.cache[apiUtilsPath];
  });

  delete require.cache[routePath];
  return require('../app/api/user/profile/route') as typeof import('../app/api/user/profile/route');
}

test('user profile route should update profile fields and return the normalized settings bundle', async (t) => {
  const calls: Array<{ table: string; action: string; payload?: Record<string, unknown> }> = [];
  const scoped = profileScoped({
    selectUsers: () => { throw new Error('profile patch must not read the users row'); },
    updateUsers: (payload) => {
      calls.push({ table: 'users', action: 'update', payload });
      return { ...BASE_ROW, nickname: payload.nickname };
    },
    selectSettings: () => ({
      expression_style: 'gentle',
      custom_instructions: 'keep calm',
      user_profile: { identity: 'tester' },
      prompt_kb_ids: ['kb-1'],
    }),
  });
  const routeModule = installRoute(t, scoped);

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
  const scoped = profileScoped({
    selectUsers: () => ({
      id: 'user-1',
      nickname: '过期会员',
      avatar_url: null,
      is_admin: false,
      membership: 'pro',
      membership_expires_at: '2020-01-01T00:00:00.000Z',
      ai_chat_count: 7,
    }),
    selectSettings: () => null,
  });
  const routeModule = installRoute(t, scoped);

  const response = await routeModule.GET(new Request('http://localhost/api/user/profile?scope=profile') as never);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.profile?.membership, 'free');
  assert.equal(payload.profile?.membership_expires_at, null);
  assert.equal(payload.profile?.ai_chat_count, 7);
});

test('user profile route should recover a missing user row before returning profile data', async (t) => {
  let ensured = false;
  let userLookupCount = 0;
  const scoped = profileScoped({
    selectUsers: () => {
      userLookupCount += 1;
      if (!ensured) return null;
      return {
        ...BASE_ROW,
        nickname: '补建资料',
      };
    },
    onInsert: (seed) => {
      assert.equal(seed.nickname, '补建资料');
      ensured = true;
    },
  });
  const routeModule = installRoute(t, scoped, {
    id: 'user-1',
    user_metadata: {
      nickname: '补建资料',
    },
  });

  const response = await routeModule.GET(new Request('http://localhost/api/user/profile?scope=profile') as never);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(ensured, true);
  assert.equal(userLookupCount, 2);
  assert.equal(payload.profile?.nickname, '补建资料');
});
