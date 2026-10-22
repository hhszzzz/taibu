import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { mockAIFeatureState } from './helpers/route-mock';
import { createMockScopedDb } from './helpers/db-mock';

process.env.SUPABASE_URL = 'http://localhost';
process.env.SUPABASE_ANON_KEY = 'test-anon';

type Rows = {
  user: Record<string, unknown>;
  settings: Record<string, unknown>;
  knowledgeBases: Array<Record<string, unknown>>;
};

function scopedWithRows(rows: Rows) {
  return createMockScopedDb({
    tx: async (work) => work({
      selectFrom: (table: string) => ({
        select: () => ({
          where: () => {
            const query = {
              where: () => query,
              executeTakeFirst: async () => (
                table === 'users' ? rows.user : table === 'user_settings' ? rows.settings : undefined
              ),
              execute: async () => (table === 'knowledge_bases' ? rows.knowledgeBases : []),
            };
            return query;
          },
        }),
      }),
    } as never),
  });
}

test('chat bootstrap route returns ordered prompt knowledge bases', async (t) => {
  mockAIFeatureState(t);
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  type RequireUserContextResult = Awaited<ReturnType<typeof apiUtilsModule.requireUserContext>>;

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: scopedWithRows({
      user: { id: 'user-1', membership: 'plus', membership_expires_at: null, ai_chat_count: 9 },
      settings: { prompt_kb_ids: ['kb-2', 'kb-1'] },
      knowledgeBases: [
        { id: 'kb-1', name: '知识库一', description: 'one' },
        { id: 'kb-2', name: '知识库二', description: 'two' },
      ],
    }),
  } as unknown as RequireUserContextResult);

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
  });

  const { GET } = await import('../app/api/chat/bootstrap/route');
  const response = await GET(new NextRequest('http://localhost/api/chat/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.data.promptKnowledgeBases.map((kb: { id: string }) => kb.id),
    ['kb-2', 'kb-1']
  );
  assert.equal(payload.data.userId, 'user-1');
  assert.deepEqual(payload.data.promptKnowledgeBaseIds, ['kb-2', 'kb-1']);
});

test('chat bootstrap route rejects anonymous requests', async (t) => {
  mockAIFeatureState(t);
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  type RequireUserContextResult = Awaited<ReturnType<typeof apiUtilsModule.requireUserContext>>;
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    error: { message: '请先登录', status: 401 },
  } as RequireUserContextResult);

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
  });

  const { GET } = await import('../app/api/chat/bootstrap/route');
  const response = await GET(new NextRequest('http://localhost/api/chat/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error, '请先登录');
});

test('chat bootstrap route hides prompt knowledge bases for free membership', async (t) => {
  mockAIFeatureState(t);
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  type RequireUserContextResult = Awaited<ReturnType<typeof apiUtilsModule.requireUserContext>>;

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: scopedWithRows({
      user: { id: 'user-1', membership: 'free', membership_expires_at: null, ai_chat_count: 1 },
      settings: { prompt_kb_ids: ['kb-2', 'kb-1'] },
      knowledgeBases: [
        { id: 'kb-1', name: '知识库一', description: 'one' },
        { id: 'kb-2', name: '知识库二', description: 'two' },
      ],
    }),
  } as unknown as RequireUserContextResult);

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
  });

  const { GET } = await import('../app/api/chat/bootstrap/route');
  const response = await GET(new NextRequest('http://localhost/api/chat/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.data.promptKnowledgeBases, []);
  assert.deepEqual(payload.data.promptKnowledgeBaseIds, []);
});

test('chat bootstrap route hides prompt knowledge bases when knowledge-base feature is disabled', async (t) => {
  mockAIFeatureState(t);
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');
  type RequireUserContextResult = Awaited<ReturnType<typeof apiUtilsModule.requireUserContext>>;

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalIsFeatureModuleEnabled = appSettingsModule.isFeatureModuleEnabled;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: scopedWithRows({
      user: { id: 'user-1', membership: 'plus', membership_expires_at: null, ai_chat_count: 9 },
      settings: { prompt_kb_ids: ['kb-2', 'kb-1'] },
      knowledgeBases: [
        { id: 'kb-1', name: '知识库一', description: 'one' },
        { id: 'kb-2', name: '知识库二', description: 'two' },
      ],
    }),
  } as unknown as RequireUserContextResult);
  appSettingsModule.isFeatureModuleEnabled = async () => false;

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    appSettingsModule.isFeatureModuleEnabled = originalIsFeatureModuleEnabled;
    delete require.cache[require.resolve('../app/api/chat/bootstrap/route')];
    delete require.cache[require.resolve('../lib/server/chat/bootstrap')];
  });

  delete require.cache[require.resolve('../app/api/chat/bootstrap/route')];
  delete require.cache[require.resolve('../lib/server/chat/bootstrap')];
  const { GET } = await import('../app/api/chat/bootstrap/route');
  const response = await GET(new NextRequest('http://localhost/api/chat/bootstrap'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.data.promptKnowledgeBases, []);
  assert.deepEqual(payload.data.promptKnowledgeBaseIds, []);
});

test('chat bootstrap hook should not seed an empty payload when no cache exists', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  const queryClient = new QueryClient();
  const { queryKeys } = await import('../lib/query/keys');

  assert.equal(queryClient.getQueryData(queryKeys.chatBootstrap('user-1')), undefined);
});
