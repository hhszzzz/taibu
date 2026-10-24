import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';


type SettingsRow = Record<string, unknown> | null;

function settingsTx(getRow: () => SettingsRow, onInsert?: (payload: Record<string, unknown>) => void) {
  return {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          executeTakeFirst: async () => getRow(),
        }),
      }),
    }),
    insertInto: () => ({
      values: (payload: Record<string, unknown>) => {
        onInsert?.(payload);
        return {
          onConflict: (build: (conflict: unknown) => unknown) => build({
            column: () => ({
              doUpdateSet: () => ({ execute: async () => undefined }),
            }),
          }),
        };
      },
    }),
  };
}

test('settings account precondition rejects stale cookies before any database access', async (t) => {
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const original = api.requireUserContext;
  let authenticated = 0;
  api.requireUserContext = async () => {
    authenticated++;
    return { user: { id: 'bob' }, db: createMockScopedDb() } as unknown as Awaited<ReturnType<typeof original>>;
  };
  t.after(() => { api.requireUserContext = original; });
  const { GET, PATCH } = await import('../app/api/user/settings/route');
  for (const [method, handler] of [['GET', GET], ['PATCH', PATCH]] as const) {
    const response = await handler(new NextRequest('http://localhost/api/user/settings', {
      method, headers: { 'X-Expected-User-Id': 'alice' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ language: 'en' }) } : {}),
    }));
    assert.equal(response.status, 409);
  }
  assert.equal(authenticated, 2);
});

test('user settings route should return normalized settings bundle for the current user', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  type RequireUserContextResult = Awaited<ReturnType<typeof apiUtilsModule.requireUserContext>>;
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: createMockScopedDb({
      tx: async (work) => work(settingsTx(() => ({
        expression_style: 'gentle',
        custom_instructions: 'keep calm',
        chart_prompt_detail_level: 'more',
        user_profile: { career: 'engineer' },
        prompt_kb_ids: ['kb-2', 'kb-1'],
        visualization_settings: {
          selectedDimensions: ['career', 'wealth'],
          dayunDisplayCount: 6,
          chartStyle: 'dark',
        },
      })) as never),
    }),
  } as unknown as RequireUserContextResult);

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
  });

  const { GET } = await import('../app/api/user/settings/route');
  const response = await GET(new NextRequest('http://localhost/api/user/settings'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.settings.expressionStyle, 'gentle');
  assert.equal(payload.settings.chartPromptDetailLevel, 'more');
  assert.equal(payload.settings.userProfile, null);
  assert.deepEqual(payload.settings.promptKbIds, ['kb-2', 'kb-1']);
  assert.deepEqual(payload.settings.visualizationSettings, {
    selectedDimensions: ['career', 'wealth'],
    dayunDisplayCount: 6,
    chartStyle: 'dark',
  });
});

test('user settings route PATCH should update only user_settings without touching removed feature subscriptions', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  type RequireUserContextResult = Awaited<ReturnType<typeof apiUtilsModule.requireUserContext>>;
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const upsertPayloads: Record<string, unknown>[] = [];

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: createMockScopedDb({
      tx: async (work) => work(settingsTx(() => ({
        notifications_enabled: false,
        notify_email: false,
        notify_site: false,
        chart_prompt_detail_level: 'full',
        user_profile: { identity: '创业者' },
        visualization_settings: {
          selectedDimensions: ['career', 'health'],
          dayunDisplayCount: 4,
          chartStyle: 'modern',
        },
      }), (payload) => upsertPayloads.push(payload)) as never),
    }),
  } as unknown as RequireUserContextResult);

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
  });

  const { PATCH } = await import('../app/api/user/settings/route');
  const response = await PATCH(new NextRequest('http://localhost/api/user/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notificationsEnabled: false,
      chartPromptDetailLevel: 'full',
      userProfile: {
        identity: '创业者',
        occupation: '产品经理',
      },
      visualizationSettings: {
        selectedDimensions: ['career', 'health'],
        dayunDisplayCount: 4,
        chartStyle: 'modern',
      },
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.settings.notificationsEnabled, false);
  assert.equal(payload.settings.chartPromptDetailLevel, 'full');
  assert.deepEqual(payload.settings.userProfile, { identity: '创业者' });
  assert.equal(upsertPayloads.length, 1);
  const [upsertPayload] = upsertPayloads;
  assert.ok(upsertPayload);
  assert.deepEqual(upsertPayload.user_profile, { identity: '创业者' });
  assert.deepEqual(payload.settings.visualizationSettings, {
    selectedDimensions: ['career', 'health'],
    dayunDisplayCount: 4,
    chartStyle: 'modern',
  });
});

test('settings expected account is only a precondition; authentication and server owner remain authoritative', async (t) => {
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const original = api.requireUserContext;
  t.after(() => { api.requireUserContext = original; });
  const { GET, PATCH } = await import('../app/api/user/settings/route');
  api.requireUserContext = async () => ({ error: { message: 'Unauthorized', status: 401 } });
  for (const [method, handler] of [['GET', GET], ['PATCH', PATCH]] as const) {
    assert.equal((await handler(new NextRequest('http://localhost/api/user/settings', {
      method, headers: { 'X-Expected-User-Id': 'alice' },
    }))).status, 401);
  }
  const owners: string[] = [];
  api.requireUserContext = async () => ({
    user: { id: 'alice' },
    db: createMockScopedDb({
      tx: async (work) => work({
        selectFrom: () => ({
          select: () => ({
            where: (_key: string, _operator: string, owner: string) => {
              owners.push(owner);
              return { executeTakeFirst: async () => ({}) };
            },
          }),
        }),
        insertInto: () => ({
          values: (payload: { user_id: string }) => {
            owners.push(payload.user_id);
            return {
              onConflict: (build: (conflict: unknown) => unknown) => build({
                column: () => ({
                  doUpdateSet: () => ({ execute: async () => undefined }),
                }),
              }),
            };
          },
        }),
      } as never),
    }),
  }) as unknown as Awaited<ReturnType<typeof original>>;
  for (const [method, handler] of [['GET', GET], ['PATCH', PATCH]] as const) {
    for (const expected of [undefined, 'alice']) {
      const response = await handler(new NextRequest('http://localhost/api/user/settings', {
        method, headers: expected ? { 'X-Expected-User-Id': expected } : {},
        ...(method === 'PATCH' ? { body: JSON.stringify({ language: 'en', user_id: 'bob' }) } : {}),
      }));
      assert.equal(response.status, 200);
    }
  }
  assert.ok(owners.length > 0 && owners.every(owner => owner === 'alice'));
});

test('Agent preference updates preserve display settings and reject invalid templates or memory consent before writing', async t => {
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const template = { id: 'career', name: '事业', content: '分析：{{question}}' };
  let settings: Record<string, unknown> = { chat_preferences: { width: 980, fontScale: 115, desktopNotifications: true, promptTemplates: [template], memoryEnabled: true } };
  const writes: Record<string, unknown>[] = [];
  t.mock.method(api, 'requireUserContext', async () => ({
    user: { id: 'alice' },
    db: createMockScopedDb({
      tx: async (work) => work(settingsTx(() => settings, (payload) => {
        assert.equal(payload.user_id, 'alice');
        writes.push(payload);
        settings = payload;
      }) as never),
    }),
  }) as unknown as Awaited<ReturnType<typeof api.requireUserContext>>);
  const { PATCH } = await import('../app/api/user/settings/route');
  const patch = (chatPreferences: unknown) => PATCH(new NextRequest('http://localhost/api/user/settings', { method: 'PATCH', headers: { 'X-Expected-User-Id': 'alice' }, body: JSON.stringify({ chatPreferences, user_id: 'bob' }) }));
  for (const input of [{ memoryEnabled: 'true' }, { promptTemplates: [template, template] }, { promptTemplates: [{ ...template, content: '' }] }]) assert.equal((await patch(input)).status, 400);
  assert.equal(writes.length, 0);
  const response = await patch({ memoryEnabled: false });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).settings.chatPreferences, { width: 980, fontScale: 115, desktopNotifications: true, promptTemplates: [template], memoryEnabled: false });
  assert.equal(writes.length, 1);
  assert.equal((await patch({ promptTemplates: [] })).status, 200);
  assert.deepEqual((settings.chat_preferences as { promptTemplates: unknown }).promptTemplates, []);
});
