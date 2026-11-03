import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';



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
  let capturedModelWindow: unknown = null;
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
    capturedModelWindow = context.modelWindow;
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
    metered: true,
    requestedModelId: 'deepseek-chat',
    reasoningEnabled: false,
  }, { modelWindow: { contextWindow: 128_000, maxOutput: 8_192 } });

  assert.equal(budgetCalls, 1);
  assert.equal(resolvePersonality.mock.callCount(), 1);
  assert.deepEqual(capturedVisualizationSettings, {
    selectedDimensions: ['career', 'wealth'],
    dayunDisplayCount: 6,
    chartStyle: 'classic-chinese',
  });
  assert.deepEqual(capturedModelWindow, { contextWindow: 128_000, maxOutput: 8_192 });
});

test('buildChatPromptContext searches the prompt knowledge bases as the caller, whoever they are', async (t) => {
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const searchModule = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');

  const originalBuildPromptWithSources = promptBuilderModule.buildPromptWithSources;
  const originalGetPromptBudget = promptBuilderModule.calculatePromptBudget;
  const originalFeatureEnabled = appSettingsModule.isFeatureModuleEnabled;
  const originalSearchKnowledge = searchModule.searchKnowledge;
  let captured: { userId?: string; kbIds?: string[] } | null = null;

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
    captured = { userId: options?.userId, kbIds: options?.kbIds };
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
    metered: true,
    requestedModelId: 'deepseek-chat',
    reasoningEnabled: false,
  });

  assert.deepEqual(captured, { userId: 'user-1', kbIds: ['kb-1'] });
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
    metered: true,
    requestedModelId: 'deepseek-chat',
    reasoningEnabled: false,
  }, { webSearch: true });

  const content = result.sanitizedMessages[0].content;
  assert.match(content, /^【发送时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2} 星期.，Asia\/Shanghai（UTC\+08:00）】\n【用户上传的文件/u, 'dated in China Standard Time without a zone from the browser');
  assert.ok(content.includes('年份\t\t干支\n\n备注 @{原样保留}'), 'the document keeps its empty cells, paragraphs and own text');
  assert.ok(content.includes('第一段\n\n第二段'));
  assert.ok(content.endsWith('【用户的问题如下】\n看看 这个'), content.slice(-40));
  assert.deepEqual(queries, ['看看 这个'], 'mention tokens never reach the search provider');
  assert.deepEqual(result.metadata.webSearch, { status: 'ok', sources: [{ title: '流年', url: 'https://example.com' }] });
});

test('the last user message is dated in the zone the browser sent; earlier messages are left as they were', async (t) => {
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');
  stubSettings(t, { expression_style: 'direct', user_profile: {}, custom_instructions: '', prompt_kb_ids: [], visualization_settings: {} });
  t.mock.method(promptBuilderModule, 'calculatePromptBudget', async () => 1024);
  t.mock.method(appSettingsModule, 'isFeatureModuleEnabled', async () => false);
  const { buildChatPromptContext } = await import('../lib/server/chat/prompt-context');
  const request = (timezone: string | undefined) => buildChatPromptContext({
    body: {
      messages: [
        { id: 'm1', role: 'user', content: '昨天问过的事', createdAt: '2026-10-23T01:00:00.000Z' },
        { id: 'a1', role: 'assistant', content: '答', createdAt: '2026-10-23T01:00:05.000Z' },
        { id: 'm2', role: 'user', content: '现在起一卦', createdAt: new Date().toISOString() },
      ],
      stream: false,
      timezone,
    },
    userId: 'user-1', metered: true, requestedModelId: 'deepseek-chat', reasoningEnabled: false,
  });
  const result = await request('America/New_York');
  assert.equal(result.sanitizedMessages[0].content, '昨天问过的事');
  assert.match(result.sanitizedMessages[2].content, /^【发送时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2} 星期.，America\/New_York（UTC-0[45]:00）】\n现在起一卦$/u);
  assert.ok(!result.systemPrompt.includes('发送时间'));
  assert.match((await request('Not/AZone')).sanitizedMessages[2].content, /^【发送时间：[^】]+Asia\/Shanghai（UTC\+08:00）】\n/u);
});

test('a follow-up without its own mention keeps the chart from the previous user turn', async (t) => {
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const mentionsModule = require('../lib/mentions') as typeof import('../lib/mentions');
  stubSettings(t, { expression_style: 'direct', user_profile: {}, custom_instructions: '', prompt_kb_ids: [], visualization_settings: {} });
  t.mock.method(promptBuilderModule, 'calculatePromptBudget', async () => 1024);
  t.mock.method(appSettingsModule, 'isFeatureModuleEnabled', async () => false);

  const resolved: string[] = [];
  t.mock.method(mentionsModule, 'resolveMention', async (mention: { id?: string }) => {
    resolved.push(mention.id ?? '');
    return '# 紫微命盘\n命宫在戌';
  });

  let capturedMentions: Array<{ id?: string; resolvedContent?: string }> = [];
  t.mock.method(promptBuilderModule, 'buildPromptWithSources', async (context: { mentions: Array<{ id?: string; resolvedContent?: string }> }) => {
    capturedMentions = context.mentions;
    return { systemPrompt: '', userMessagePrefix: '', userMessageTokens: 0, sources: [], diagnostics: [], totalTokens: 0, budgetTotal: 0 };
  });

  const { buildChatPromptContext } = await import('../lib/server/chat/prompt-context');
  const result = await buildChatPromptContext({
    body: {
      messages: [
        {
          id: 'm1', role: 'user', content: '@杨旭垲的紫微命盘 请分析命宫', createdAt: '2026-10-23T01:00:00.000Z',
          mentions: [{ id: 'chart-1', type: 'ziwei_chart', name: '杨旭垲的紫微命盘', preview: '杨旭垲 · 2003-02-11' }],
        },
        { id: 'a1', role: 'assistant', content: '先说结论', createdAt: '2026-10-23T01:00:05.000Z' },
        { id: 'm2', role: 'user', content: '继续', createdAt: '2026-10-23T01:00:10.000Z' },
      ],
      stream: false,
    },
    userId: 'user-1', metered: true, requestedModelId: 'deepseek-chat', reasoningEnabled: false,
  });

  assert.deepEqual(resolved, ['chart-1'], 'the earlier chart is re-resolved for the follow-up');
  assert.equal(capturedMentions.length, 1);
  assert.equal(capturedMentions[0]?.resolvedContent, '# 紫微命盘\n命宫在戌');
  assert.equal(result.sanitizedMessages[2].content, '继续', 'the follow-up text itself stays untouched');
});

test('a current mention replaces the inherited one instead of stacking stale charts', async (t) => {
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const mentionsModule = require('../lib/mentions') as typeof import('../lib/mentions');
  stubSettings(t, { expression_style: 'direct', user_profile: {}, custom_instructions: '', prompt_kb_ids: [], visualization_settings: {} });
  t.mock.method(promptBuilderModule, 'calculatePromptBudget', async () => 1024);
  t.mock.method(appSettingsModule, 'isFeatureModuleEnabled', async () => false);
  t.mock.method(mentionsModule, 'resolveMention', async (mention: { id?: string }) => `resolved:${mention.id ?? ''}`);
  let capturedMentions: Array<{ id?: string }> = [];
  t.mock.method(promptBuilderModule, 'buildPromptWithSources', async (context: { mentions: Array<{ id?: string }> }) => {
    capturedMentions = context.mentions;
    return { systemPrompt: '', userMessagePrefix: '', userMessageTokens: 0, sources: [], diagnostics: [], totalTokens: 0, budgetTotal: 0 };
  });

  const { buildChatPromptContext } = await import('../lib/server/chat/prompt-context');
  await buildChatPromptContext({
    body: {
      messages: [
        {
          id: 'm1', role: 'user', content: '@旧命盘 请分析', createdAt: '2026-10-23T01:00:00.000Z',
          mentions: [{ id: 'old-chart', type: 'ziwei_chart', name: '旧命盘', preview: '旧' }],
        },
        { id: 'a1', role: 'assistant', content: '答', createdAt: '2026-10-23T01:00:05.000Z' },
        {
          id: 'm2', role: 'user', content: '@新命盘 换这张', createdAt: '2026-10-23T01:00:10.000Z',
          mentions: [{ id: 'new-chart', type: 'ziwei_chart', name: '新命盘', preview: '新' }],
        },
      ],
      stream: false,
      mentions: [{ id: 'new-chart', type: 'ziwei_chart', name: '新命盘', preview: '新' }],
    },
    userId: 'user-1', metered: true, requestedModelId: 'deepseek-chat', reasoningEnabled: false,
  });

  assert.deepEqual(capturedMentions.map(mention => mention.id), ['new-chart']);
});

test('direct chat carries every persisted conversation mention forward', async (t) => {
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const mentionsModule = require('../lib/mentions') as typeof import('../lib/mentions');
  stubSettings(t, { expression_style: 'direct', user_profile: {}, custom_instructions: '', prompt_kb_ids: [], visualization_settings: {} });
  t.mock.method(promptBuilderModule, 'calculatePromptBudget', async () => 4096);
  t.mock.method(appSettingsModule, 'isFeatureModuleEnabled', async () => false);
  t.mock.method(mentionsModule, 'resolveMention', async (mention: { id?: string }) => `resolved:${mention.id ?? ''}`);
  let capturedMentions: Array<{ id?: string }> = [];
  t.mock.method(promptBuilderModule, 'buildPromptWithSources', async (context: { mentions: Array<{ id?: string }> }) => {
    capturedMentions = context.mentions;
    return { systemPrompt: '', userMessagePrefix: '', userMessageTokens: 0, sources: [], diagnostics: [], totalTokens: 0, budgetTotal: 0 };
  });

  const { buildChatPromptContext } = await import('../lib/server/chat/prompt-context');
  await buildChatPromptContext({
    body: {
      messages: [
        {
          id: 'm1', role: 'user', content: '@旧命盘 请分析', createdAt: '2026-10-23T01:00:00.000Z',
          mentions: [{ id: 'old-chart', type: 'ziwei_chart', name: '旧命盘', preview: '旧' }],
        },
        { id: 'a1', role: 'assistant', content: '答', createdAt: '2026-10-23T01:00:05.000Z' },
        {
          id: 'm2', role: 'user', content: '@新命盘 也看看', createdAt: '2026-10-23T01:00:10.000Z',
          mentions: [{ id: 'new-chart', type: 'ziwei_chart', name: '新命盘', preview: '新' }],
        },
        { id: 'a2', role: 'assistant', content: '答', createdAt: '2026-10-23T01:00:15.000Z' },
        { id: 'm3', role: 'user', content: '继续', createdAt: '2026-10-23T01:00:20.000Z' },
      ],
      stream: false,
    },
    userId: 'user-1', metered: true, requestedModelId: 'deepseek-chat', reasoningEnabled: false,
  }, { conversationMentions: true });

  assert.deepEqual(capturedMentions.map(mention => mention.id), ['new-chart', 'old-chart']);
});

test('quotes reach the prompt builder and move into the last message instead of staying on it', async (t) => {
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const originalBuildPromptWithSources = promptBuilderModule.buildPromptWithSources;
  const originalFeatureEnabled = appSettingsModule.isFeatureModuleEnabled;
  stubSettings(t, { expression_style: 'direct', user_profile: {}, custom_instructions: '', prompt_kb_ids: [], visualization_settings: {} });
  let capturedQuotes: unknown;
  t.mock.method(promptBuilderModule, 'calculatePromptBudget', async () => 1024);
  promptBuilderModule.buildPromptWithSources = (async (context) => {
    capturedQuotes = context.quotes;
    return { systemPrompt: '', userMessagePrefix: '【引用块】\n\n', userMessageTokens: 0, sources: [], diagnostics: [], totalTokens: 0, budgetTotal: 0 };
  }) as typeof promptBuilderModule.buildPromptWithSources;
  appSettingsModule.isFeatureModuleEnabled = (async () => false) as typeof appSettingsModule.isFeatureModuleEnabled;
  t.after(() => {
    promptBuilderModule.buildPromptWithSources = originalBuildPromptWithSources;
    appSettingsModule.isFeatureModuleEnabled = originalFeatureEnabled;
    delete require.cache[require.resolve('../lib/server/chat/prompt-context')];
  });
  delete require.cache[require.resolve('../lib/server/chat/prompt-context')];
  const { buildChatPromptContext } = await import('../lib/server/chat/prompt-context');
  const quotes = [{ messageId: 'a1', text: '庚金带煞' }];
  const result = await buildChatPromptContext({
    body: {
      messages: [
        { id: 'a1', role: 'assistant', content: '庚金带煞', createdAt: '2026-10-23T01:00:00.000Z' },
        { id: 'u1', role: 'user', content: '解释一下', createdAt: '2026-10-23T01:00:05.000Z', quotes },
      ],
      stream: false,
    },
    userId: 'user-1', metered: true, requestedModelId: 'deepseek-chat', reasoningEnabled: false,
  });
  assert.deepEqual(capturedQuotes, quotes);
  assert.equal(result.sanitizedMessages[1].content, '【引用块】\n\n解释一下');
  assert.equal('quotes' in result.sanitizedMessages[1], false, 'the Agent must not serialize the same quotes again from pi history');
});
