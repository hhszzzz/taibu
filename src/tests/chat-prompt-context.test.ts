import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';


function stubSettings(t: import('node:test').TestContext, row: Record<string, unknown>) {
  const contextModule = require('../lib/db/context.server') as any;
  const original = contextModule.systemDb;
  contextModule.systemDb = () => createMockScopedDb({
    tx: async (work) => work({
      selectFrom: () => ({
        select: () => ({
          where: () => ({ executeTakeFirst: async () => row }),
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
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');

  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
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

  apiUtilsModule.getSystemAdminClient = (() => ({
    from(table: string) {
      if (table === 'knowledge_bases') {
        return {
          select() {
            return {
              eq() {
                return {
                  in: async () => ({ data: [], error: null }),
                };
              },
            };
          },
        };
      }

      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
              };
            },
          };
        },
      };
    },
  })) as unknown as typeof apiUtilsModule.getSystemAdminClient;

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
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
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
    accessTokenForKB: null,
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
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const promptBuilderModule = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
  const appSettingsModule = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const searchModule = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');

  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
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
  });

  apiUtilsModule.getSystemAdminClient = (() => ({
    from(table: string) {
      if (table === 'knowledge_bases') {
        return {
          select() {
            return {
              eq() {
                return {
                  in: async () => ({
                    data: [{ id: 'kb-1', name: '知识库', weight: 'normal' }],
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
              };
            },
          };
        },
      };
    },
  })) as unknown as typeof apiUtilsModule.getSystemAdminClient;

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
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
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
    accessTokenForKB: 'token-1',
    requestedModelId: 'deepseek-chat',
    membershipType: 'pro',
    reasoningEnabled: false,
    creditDeducted: false,
  });

  assert.equal(capturedMembershipType, 'pro');
});
