import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';


function stubSettings(
  t: import('node:test').TestContext,
  row: Record<string, unknown>,
  options: { knowledgeBases?: Array<{ id: string; name: string; weight?: string }> } = {},
) {
  const contextModule = require('../lib/db/context.server') as any;
  const original = contextModule.systemDb;
  const knowledgeBases = options.knowledgeBases ?? [];
  contextModule.systemDb = () => createMockScopedDb({
    tx: async (work) => work({
      selectFrom: (table: string) => ({
        select: () => ({
          where: () => ({
            where: () => ({ execute: async () => knowledgeBases }),
            execute: async () => knowledgeBases,
            executeTakeFirst: async () => (table === 'user_settings' ? row : null),
          }),
          executeTakeFirst: async () => (table === 'user_settings' ? row : null),
        }),
      }),
    } as never),
  });
  t.after(() => { contextModule.systemDb = original; });
}

beforeEach((t) => {
  assert.ok('mock' in t);
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    networkCalls += 1;
    throw new Error('Unexpected network request');
  });
  t.after(() => assert.equal(networkCalls, 0, 'prompt tests must not attempt network access'));
});

test('buildChatPromptContext should load visualization_settings from user_settings', async (t) => {
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');

  const originalBuildPromptWithSources = promptBuilderModule.buildPromptWithSources;
  const originalGetPromptBudget = promptBuilderModule.calculatePromptBudget;
  const originalFeatureEnabled = appSettingsModule.isFeatureModuleEnabled;

  let budgetCalls = 0;
  const resolvePersonality = t.mock.method(promptBuilderModule, 'resolvePersonalities');
  let capturedVisualizationSettings: unknown = null;

  stubSettings(t, {
    expression_style: 'direct',
    user_profile: {},
    custom_instructions: '',
    prompt_kb_ids: [],
    visualization_settings: {
      selectedDimensions: ['career', 'wealth'],
      dayunDisplayCount: 6,
      chartStyle: 'classic-chinese',
    },
  });

  promptBuilderModule.calculatePromptBudget = (async () => { budgetCalls++; return 1024; }) as typeof promptBuilderModule.calculatePromptBudget;
  promptBuilderModule.buildPromptWithSources = (async (context, prepared) => {
    assert.equal(prepared?.budget, 1024);
    assert.ok(prepared?.personalityResolution);
    capturedVisualizationSettings = context.userSettings?.visualizationSettings;
    return {
      systemPrompt: '',
      userMessagePrefix: '',
      userMessageTokens: 0,
      sources: [],
      diagnostics: [],
      totalTokens: 0,
      budgetTotal: 0,
    };
  }) as typeof promptBuilderModule.buildPromptWithSources;
  appSettingsModule.isFeatureModuleEnabled = (async () => false) as typeof appSettingsModule.isFeatureModuleEnabled;

  t.after(() => {
    promptBuilderModule.buildPromptWithSources = originalBuildPromptWithSources;
    promptBuilderModule.calculatePromptBudget = originalGetPromptBudget;
    appSettingsModule.isFeatureModuleEnabled = originalFeatureEnabled;
    delete require.cache[require.resolve('../lib/server/chat/prompt-context')];
  });

  const { buildChatPromptContext } = await import('../lib/server/chat/prompt-context');
  await buildChatPromptContext({
    body: {
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '请分析',
          createdAt: new Date().toISOString(),
        },
      ],
      stream: false,
    },
    userId: 'user-1',
    canSkipCredit: false,
    requestedModelId: 'deepseek-chat',
    membershipType: 'free',
    reasoningEnabled: false,
    creditDeducted: false,
  });

  assert.equal(budgetCalls, 1);
  assert.equal(resolvePersonality.mock.callCount(), 1);
  assert.deepEqual(capturedVisualizationSettings, {
    selectedDimensions: ['career', 'wealth'],
    dayunDisplayCount: 6,
    chartStyle: 'classic-chinese',
  });
});

test('buildChatPromptContext passes resolved membershipType to knowledge search', async (t) => {
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const searchModule = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');

  const originalBuildPromptWithSources = promptBuilderModule.buildPromptWithSources;
  const originalGetPromptBudget = promptBuilderModule.calculatePromptBudget;
  const originalFeatureEnabled = appSettingsModule.isFeatureModuleEnabled;
  const originalSearchKnowledge = searchModule.searchKnowledge;
  let capturedMembershipType: unknown = null;

  stubSettings(t, {
    expression_style: 'direct',
    user_profile: {},
    custom_instructions: '',
    prompt_kb_ids: ['kb-1'],
    visualization_settings: null,
  }, { knowledgeBases: [{ id: 'kb-1', name: '知识库', weight: 'normal' }] });

  promptBuilderModule.calculatePromptBudget = (async () => 1024) as typeof promptBuilderModule.calculatePromptBudget;
  promptBuilderModule.buildPromptWithSources = (async () => ({
    systemPrompt: '',
    userMessagePrefix: '',
    userMessageTokens: 0,
    sources: [],
    diagnostics: [],
    totalTokens: 0,
    budgetTotal: 0,
  })) as typeof promptBuilderModule.buildPromptWithSources;
  appSettingsModule.isFeatureModuleEnabled = (async () => true) as typeof appSettingsModule.isFeatureModuleEnabled;
  searchModule.searchKnowledge = (async (_query, options) => {
    capturedMembershipType = options?.membershipType;
    return [];
  }) as typeof searchModule.searchKnowledge;

  t.after(() => {
    promptBuilderModule.buildPromptWithSources = originalBuildPromptWithSources;
    promptBuilderModule.calculatePromptBudget = originalGetPromptBudget;
    appSettingsModule.isFeatureModuleEnabled = originalFeatureEnabled;
    searchModule.searchKnowledge = originalSearchKnowledge;
    delete require.cache[require.resolve('../lib/server/chat/prompt-context')];
  });

  delete require.cache[require.resolve('../lib/server/chat/prompt-context')];
  const { buildChatPromptContext } = await import('../lib/server/chat/prompt-context');
  await buildChatPromptContext({
    body: {
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '请在知识库里查一下',
          createdAt: new Date().toISOString(),
        },
      ],
      stream: false,
    },
    userId: 'user-1',
    canSkipCredit: false,
    requestedModelId: 'deepseek-chat',
    membershipType: 'pro',
    reasoningEnabled: false,
    creditDeducted: false,
  });

  assert.equal(capturedMembershipType, 'pro');
});

test('the document and search results keep their layout; mention tokens are stripped only from what the user typed', async (t) => {
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const webSearchModule = require('../lib/ai/web-search.server') as typeof import('../lib/ai/web-search.server');
  stubSettings(t, {
    expression_style: 'direct',
    user_profile: {},
    custom_instructions: '',
    prompt_kb_ids: [],
    visualization_settings: {},
  });
  t.mock.method(promptBuilderModule, 'calculatePromptBudget', async () => 1024);
  t.mock.method(appSettingsModule, 'isFeatureModuleEnabled', async () => false);
  const queries: string[] = [];
  t.mock.method(webSearchModule, 'searchChatWeb', async (query: string) => {
    queries.push(query);
    return { status: 'ok' as const, query, results: [{ title: '流年', url: 'https://example.com', content: '第一段\n\n第二段' }] };
  });

  const { buildChatPromptContext } = await import('../lib/server/chat/prompt-context');
  const result = await buildChatPromptContext({
    body: {
      messages: [{ id: 'm1', role: 'user', content: '看看  @{命盘}  这个', createdAt: new Date().toISOString() }],
      attachment: { name: '流年.xlsx', text: '## 工作表：流年\n年份\t\t干支\n\n备注 @{原样保留}' },
      stream: false,
    },
    userId: 'user-1',
    canSkipCredit: false,
    requestedModelId: 'deepseek-chat',
    membershipType: 'pro',
    reasoningEnabled: false,
    creditDeducted: false,
  }, { webSearch: true });

  const content = result.sanitizedMessages[0].content;
  assert.ok(content.includes('年份\t\t干支\n\n备注 @{原样保留}'), 'the document keeps its empty cells, paragraphs and own text');
  assert.ok(content.includes('第一段\n\n第二段'));
  assert.ok(content.endsWith('【用户的问题如下】\n看看 这个'), content.slice(-40));
  assert.deepEqual(queries, ['看看 这个'], 'mention tokens never reach the search provider');
  assert.deepEqual(result.metadata.webSearch, { status: 'ok', sources: [{ title: '流年', url: 'https://example.com' }] });
});
