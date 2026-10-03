import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { ensureRouteTestEnv, mockAIFeatureState } from './helpers/route-mock';
import { createMockAuthContext } from './helpers/supabase-mock';
import type { DivinationRouteConfig, InterpretPromptContext } from '../lib/api/divination-pipeline';

ensureRouteTestEnv();

type MutableModule = Record<string, (...args: never[]) => unknown>;

function createUIChunkStream(chunks: Array<Record<string, unknown>>): ReadableStream<Record<string, unknown>> {
  return new ReadableStream<Record<string, unknown>>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function createMockUIMessageResult(
  chunks: Array<Record<string, unknown>>,
  responseMessage: { parts: Array<Record<string, unknown>> },
  finishOptions?: { isAborted?: boolean; finishReason?: string },
) {
  return {
    toUIMessageStream(streamOptions?: {
      onFinish?: (event: {
        responseMessage: { parts: Array<Record<string, unknown>> };
        finishReason?: string;
        isAborted: boolean;
        isContinuation: boolean;
        messages: Array<{ parts: Array<Record<string, unknown>> }>;
      }) => PromiseLike<void> | void;
    }) {
      const stream = createUIChunkStream(chunks);
      queueMicrotask(() => {
        void streamOptions?.onFinish?.({
          responseMessage,
          finishReason: finishOptions?.finishReason ?? 'stop',
          isAborted: finishOptions?.isAborted ?? false,
          isContinuation: false,
          messages: [responseMessage],
        });
      });
      return stream;
    },
  };
}

function setupPipelineMocks(t: TestContext) {
  mockAIFeatureState(t);
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    networkCalls += 1;
    throw new Error('Unexpected network request');
  });
  t.after(() => assert.equal(networkCalls, 0, 'pipeline tests must not attempt network access'));
  const rateLimit = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
  t.mock.method(rateLimit, 'checkRateLimit', async () => ({ allowed: true, remaining: 19, resetAt: new Date() }));
  const apiUtils = require('../lib/api-utils') as MutableModule;
  const credits = require('../lib/user/credits') as MutableModule;
  const aiAccess = require('../lib/ai/ai-access') as MutableModule;
  const aiModule = require('../lib/ai/ai') as MutableModule;
  const aiAnalysisModule = require('../lib/ai/ai-analysis') as MutableModule;

  const originals = {
    requireBearerUser: apiUtils.requireBearerUser,
    getUserAuthInfo: credits.getUserAuthInfo,
    attemptCreditUse: credits.attemptCreditUse,
    useCredit: credits.useCredit,
    refundCreditsOrLog: credits.refundCreditsOrLog,
    addCredits: credits.addCredits,
    resolveModelAccessAsync: aiAccess.resolveModelAccessAsync,
    callAIWithReasoning: aiModule.callAIWithReasoning,
    callAIUIMessageResult: aiModule.callAIUIMessageResult,
    callAIVision: aiModule.callAIVision,
    createAIAnalysisConversation: aiAnalysisModule.createAIAnalysisConversation,
  };

  apiUtils.requireBearerUser = async () => createMockAuthContext({
    from: () => assert.fail('unexpected query: credit and persistence repositories are mocked'),
  });
  credits.getUserAuthInfo = async () => ({
    credits: 10,
    effectiveMembership: 'pro',
    hasCredits: true,
  });
  credits.attemptCreditUse = async () => ({
    ok: true,
    remaining: 1,
  });
  credits.useCredit = async () => 1;
  credits.refundCreditsOrLog = async () => true;
  credits.addCredits = async () => 1;
  aiAccess.resolveModelAccessAsync = async () => ({
    modelId: 'test-model',
    modelConfig: {
      id: 'test-model',
      modelKey: 'test-model',
      vendor: 'test',
      usageType: 'chat',
      supportsReasoning: true,
      supportsVision: false,
      requiredTier: 'free',
    },
    reasoningEnabled: false,
  });
  aiModule.callAIUIMessageResult = async () => createMockUIMessageResult([
    { type: 'reasoning-start', id: 'reasoning-1' },
    { type: 'reasoning-delta', id: 'reasoning-1', delta: 'reason' },
    { type: 'reasoning-end', id: 'reasoning-1' },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: 'analysis' },
    { type: 'text-end', id: 'text-1' },
  ], {
    parts: [
      { type: 'reasoning', text: 'reason', state: 'done' },
      { type: 'text', text: 'analysis', state: 'done' },
    ],
  });
  aiModule.callAIWithReasoning = async () => ({
    content: 'analysis',
    reasoning: 'reason',
  });
  aiModule.callAIVision = async () => 'vision-analysis';

  const createCalls: Array<Record<string, unknown>> = [];
  aiAnalysisModule.createAIAnalysisConversation = async (args: Record<string, unknown>) => {
    createCalls.push(args);
    return 'conv-1';
  };

  const pipelinePath = require.resolve('../lib/api/divination-pipeline');
  delete require.cache[pipelinePath];

  t.after(() => {
    apiUtils.requireBearerUser = originals.requireBearerUser;
    credits.getUserAuthInfo = originals.getUserAuthInfo;
    credits.attemptCreditUse = originals.attemptCreditUse;
    credits.useCredit = originals.useCredit;
    credits.refundCreditsOrLog = originals.refundCreditsOrLog;
    credits.addCredits = originals.addCredits;
    aiAccess.resolveModelAccessAsync = originals.resolveModelAccessAsync;
    aiModule.callAIWithReasoning = originals.callAIWithReasoning;
    aiModule.callAIUIMessageResult = originals.callAIUIMessageResult;
    aiModule.callAIVision = originals.callAIVision;
    aiAnalysisModule.createAIAnalysisConversation = originals.createAIAnalysisConversation;
    delete require.cache[pipelinePath];
  });

  return {
    apiUtils,
    credits,
    aiModule,
    aiAnalysisModule,
    createCalls,
    loadPipeline: () => {
      delete require.cache[pipelinePath];
      return require('../lib/api/divination-pipeline') as typeof import('../lib/api/divination-pipeline');
    },
  };
}

function createTestRequest() {
  return new NextRequest('http://localhost/api/test-divination', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
  });
}

function createTestHandler(
  createInterpretHandler: typeof import('../lib/api/divination-pipeline').createInterpretHandler,
  persistRecord?: (input: Record<string, unknown>, userId: string, conversationId: string | null) => Promise<void>,
) {
  return createInterpretHandler<Record<string, unknown>>({
    sourceType: 'test_divination',
    tag: 'test-divination',
    parseInput: (body) => (body ?? {}) as Record<string, unknown>,
    buildPrompts: () => ({
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
    }),
    buildSourceData: (input, modelId, reasoningEnabled) => ({
      inputId: input.id ?? null,
      modelId,
      reasoningEnabled,
    }),
    generateTitle: () => 'Shared Pipeline Test',
    persistRecord,
  });
}

function setupAdmissionMocks(t: TestContext) {
  const state = setupPipelineMocks(t);
  const events: string[] = [];
  const limits = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
  const access = require('../lib/ai/ai-access') as MutableModule;
  state.credits.getUserAuthInfo = async () => {
    events.push('account');
    return { effectiveMembership: 'free', hasCredits: true, credits: 1 };
  };
  state.credits.attemptCreditUse = async () => { events.push('debit'); return { ok: true, remaining: 0 }; };
  state.credits.refundCreditsOrLog = async () => { events.push('refund'); return true; };
  access.resolveModelAccessAsync = async () => {
    events.push('membership');
    return { modelId: 'test-model', reasoningEnabled: false };
  };
  t.mock.method(limits, 'checkRateLimit', async (userId: string, endpoint: string, config: unknown) => {
    events.push('limit');
    assert.equal(userId, 'user-1');
    assert.equal(endpoint, '/api/test-divination');
    assert.equal(config, limits.AI_RATE_LIMIT_CONFIG);
    assert.deepEqual(config, { maxRequests: 20, windowMs: 60_000 });
    return { allowed: true, remaining: 19, resetAt: new Date() };
  });
  for (const name of ['callAIWithReasoning', 'callAIUIMessageResult', 'callAIVision']) {
    const original = state.aiModule[name];
    state.aiModule[name] = async () => { events.push('infer'); return original(); };
  }
  state.aiAnalysisModule.createAIAnalysisConversation = async (input: Record<string, unknown>) => {
    events.push('save');
    state.createCalls.push(input);
    return 'conv-1';
  };
  const config: DivinationRouteConfig = {
    sourceType: 'test_divination', tag: 'test-divination',
    parseInput: () => { events.push('parse'); return {}; },
    precheck: () => { events.push('precheck'); return null; },
    resolvePromptContext: () => { events.push('ownership'); return { userId: 'user-1', chartPromptDetailLevel: 'full' }; },
    buildPrompts: () => { events.push('prompt'); return { systemPrompt: 'system', userPrompt: 'user' }; },
    buildSourceData: () => ({}), generateTitle: () => 'Admission test',
  };
  return { ...state, events, limits, access, config };
}

type AdmissionMode = 'text' | 'vision' | 'stream';
function modeConfig(config: DivinationRouteConfig, mode: AdmissionMode): DivinationRouteConfig {
  return { ...config, isVision: mode === 'vision', buildVisionOptions: () => ({ imageBase64: 'ZmFrZQ==', imageMimeType: 'image/png' }) };
}

for (const mode of ['text', 'vision', 'stream'] as const) {
  test(`${mode} admission orders ownership/member/debit/limit/prompt before inference and save`, async (t) => {
    const state = setupAdmissionMocks(t);
    const handler = state.loadPipeline().createInterpretHandler(modeConfig(state.config, mode));
    const response = await handler(createTestRequest(), { stream: mode === 'stream' });
    await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(state.events, ['parse', 'precheck', 'ownership', 'account', 'membership', 'debit', 'limit', 'prompt', 'infer', 'save']);
  });
}

// Account gates run before transport selection; verify each HTTP rejection once.
for (const [failure, status] of [['membership', 403], ['balance', 402], ['debit', 500]] as const) {
  test(`${failure} failure does not consume a rate slot or assemble prompts`, async (t) => {
    const state = setupAdmissionMocks(t);
    state.credits.getUserAuthInfo = async () => {
      state.events.push('account');
      return { effectiveMembership: 'free', hasCredits: failure === 'debit', credits: 0 };
    };
    if (failure === 'membership') {
      state.access.resolveModelAccessAsync = async () => {
        state.events.push('membership');
        return { error: 'membership denied', status: 403 };
      };
    }
    state.credits.attemptCreditUse = async () => {
      state.events.push('debit');
      return { ok: false, reason: 'deduction_failed' };
    };
    const response = await state.loadPipeline().createInterpretHandler(state.config)(createTestRequest(), {});
    assert.equal(response.status, status);
    assert.deepEqual(state.events, ['parse', 'precheck', 'ownership', 'account', 'membership', ...(failure === 'debit' ? ['debit'] : [])]);
    assert.equal(state.createCalls.length, 0);
  });
}

// analysis-use-case.test.ts owns all failure × refund combinations. Here retain
// every HTTP mapping, each transport's rejection wiring, and both refund failure forms.
for (const [mode, failure, refund, status, code] of [
  ['text', 'limited', 'success', 429, undefined],
  ['vision', 'limited', 'success', 429, undefined],
  ['stream', 'limited', 'success', 429, undefined],
  ['text', 'rate-error', 'success', 500, 'RATE_LIMIT_FAILED'],
  ['stream', 'prompt-error', 'success', 500, 'PROMPT_PREPARATION_FAILED'],
  ['vision', 'limited', 'failure', 500, 'CREDIT_REFUND_FAILED'],
  ['text', 'rate-error', 'throw', 500, 'CREDIT_REFUND_FAILED'],
] as const) {
  test(`${mode} ${failure}, refund ${refund}: controlled HTTP outcome without inference/save`, async (t) => {
    const state = setupAdmissionMocks(t);
    t.mock.method(state.limits, 'checkRateLimit', async () => {
      state.events.push('limit');
      if (failure === 'rate-error') throw new Error('limiter failed');
      return { allowed: failure !== 'limited', remaining: 0, resetAt: new Date() };
    });
    state.config.buildPrompts = () => { state.events.push('prompt'); throw new Error('prompt failed'); };
    state.credits.refundCreditsOrLog = async (...args: unknown[]) => {
      state.events.push('refund');
      assert.deepEqual(args, ['user-1', 1, 'test-divination admission']);
      if (refund === 'throw') throw new Error('refund failed');
      return refund === 'success';
    };
    const handler = state.loadPipeline().createInterpretHandler(modeConfig(state.config, mode));
    const response = await handler(createTestRequest(), { stream: mode === 'stream' });
    const payload = await response.json();
    assert.equal(response.status, status);
    assert.equal(payload.code, code);
    assert.equal(payload.refundFailed, code === 'CREDIT_REFUND_FAILED' ? true : undefined);
    assert.deepEqual(state.events, ['parse', 'precheck', 'ownership', 'account', 'membership', 'debit', 'limit', ...(failure === 'prompt-error' ? ['prompt'] : []), 'refund']);
    assert.equal(state.createCalls.length, 0);
  });
}

for (const stage of ['precheck', 'ownership'] as const) {
  test(`ordinary ${stage} rejection remains before charged admission`, async (t) => {
    const state = setupAdmissionMocks(t);
    if (stage === 'precheck') state.config.precheck = () => { state.events.push('precheck'); return { error: 'forbidden', status: 403 }; };
    else state.config.resolvePromptContext = () => { state.events.push('ownership'); return { error: 'not found', status: 404 }; };
    const response = await state.loadPipeline().createInterpretHandler(state.config)(createTestRequest(), {});
    assert.equal(response.status, stage === 'precheck' ? 403 : 404);
    assert.deepEqual(state.events, ['parse', 'precheck', ...(stage === 'ownership' ? ['ownership'] : [])]);
  });
}

test('direct prepare validates account before default rate admission and persist adds no fee, inference, or slot', async (t) => {
  const state = setupAdmissionMocks(t);
  state.credits.getUserAuthInfo = async () => {
    state.events.push('account');
    return { effectiveMembership: 'free', hasCredits: false, credits: 0 };
  };
  const handlers = state.loadPipeline().createDirectInterpretHandlers(state.config);
  const response = await handlers.handleDirectPrepare(createTestRequest(), {});
  assert.deepEqual(await response.json(), { success: true, data: { systemPrompt: 'system', userPrompt: 'user' } });
  assert.deepEqual(state.events, ['parse', 'precheck', 'ownership', 'account', 'limit', 'prompt']);
  state.events.length = 0;
  const saved = await handlers.handleDirectPersist(createTestRequest(), { content: 'browser output', customModelId: 'private-model' });
  assert.equal(saved.status, 200);
  assert.deepEqual(state.events, ['parse', 'ownership', 'save']);
});

for (const failure of ['account', 'limited', 'rate-error', 'prompt-error'] as const) {
  test(`direct ${failure} failure never debits or refunds`, async (t) => {
    const state = setupAdmissionMocks(t);
    if (failure === 'account') {
      const { UserStateResolutionError } = require('../lib/user/credits') as typeof import('../lib/user/credits');
      state.credits.getUserAuthInfo = async () => { state.events.push('account'); throw new UserStateResolutionError('account failed', 'USER_QUERY_FAILED'); };
    }
    t.mock.method(state.limits, 'checkRateLimit', async () => {
      state.events.push('limit');
      if (failure === 'rate-error') throw new Error('limit failed');
      return { allowed: failure !== 'limited', remaining: 0, resetAt: new Date() };
    });
    state.config.buildPrompts = () => { state.events.push('prompt'); throw new Error('prompt failed'); };
    const response = await state.loadPipeline().createDirectInterpretHandlers(state.config).handleDirectPrepare(createTestRequest(), {});
    const payload = await response.json();
    assert.equal(response.status, failure === 'limited' ? 429 : 500);
    if (failure === 'account') assert.equal(payload.code, 'USER_QUERY_FAILED');
    if (failure === 'rate-error') assert.equal(payload.code, 'RATE_LIMIT_FAILED');
    assert.deepEqual(state.events, ['parse', 'precheck', 'ownership', 'account', ...(failure !== 'account' ? ['limit'] : []), ...(failure === 'prompt-error' ? ['prompt'] : [])]);
    assert.equal(state.createCalls.length, 0);
  });
}

test('divination rejects missing caller DB context before any downstream work', async (t) => {
  const invalidContexts = [
    { user: { id: 'user-1' } },
    { user: { id: 'user-1' }, db: {}, supabase: {} },
    { user: { id: 'user-1' }, db: null, supabase: null },
  ];
  for (const authMethod of ['bearer', 'userContext'] as const) {
    for (const [index, authContext] of invalidContexts.entries()) {
      await t.test(`${authMethod} invalid DB context ${index}`, async (t) => {
        const { apiUtils, credits, aiModule, aiAnalysisModule, loadPipeline } = setupPipelineMocks(t);
        const authHelper = authMethod === 'bearer' ? 'requireBearerUser' : 'requireUserContext';
        t.mock.method(apiUtils, authHelper, async () => authContext);
        const unexpected = t.mock.fn(() => assert.fail('invalid identity reached downstream work'));
        for (const name of ['getSystemAdminClient', 'getAuthAdminClient']) {
          t.mock.method(apiUtils, name, unexpected);
        }
        for (const name of ['getUserAuthInfo', 'attemptCreditUse', 'useCredit', 'refundCreditsOrLog', 'addCredits']) {
          t.mock.method(credits, name, unexpected);
        }
        for (const name of ['callAIWithReasoning', 'callAIUIMessageResult', 'callAIVision']) {
          t.mock.method(aiModule, name, unexpected);
        }
        t.mock.method(require('../lib/ai/ai-access'), 'resolveModelAccessAsync', unexpected);
        t.mock.method(aiAnalysisModule, 'createAIAnalysisConversation', unexpected);
        const config: DivinationRouteConfig = {
          sourceType: 'test_divination', tag: 'test-divination', authMethod,
          parseInput: () => ({}), precheck: unexpected, resolvePromptContext: unexpected,
          buildPrompts: unexpected, buildSourceData: unexpected, generateTitle: unexpected,
          buildHistoryBinding: unexpected, persistRecord: unexpected,
        };
        const pipeline = loadPipeline();
        const managed = pipeline.createInterpretHandler(config);
        const vision = pipeline.createInterpretHandler({ ...config, isVision: true, buildVisionOptions: unexpected });
        const direct = pipeline.createDirectInterpretHandlers(config);
        // Save always uses userContext, independently of the interpret auth default.
        t.mock.method(apiUtils, 'requireUserContext', async () => authContext);
        const responses = [
          await managed(createTestRequest(), {}),
          await managed(createTestRequest(), { stream: true }),
          await vision(createTestRequest(), {}),
          await direct.handleDirectPrepare(createTestRequest(), {}),
          await direct.handleDirectPersist(createTestRequest(), { content: 'analysis' }),
          await pipeline.saveUserOwnedDivinationRecord({
            request: createTestRequest(), tag: 'test-divination', tableName: 'test_records',
            responseKey: 'recordId', input: {}, buildInsertPayload: unexpected,
          }),
        ];
        for (const response of responses) {
          assert.equal(response.status, 500);
          assert.deepEqual(await response.json(), {
            error: '用户数据库上下文不可用，请稍后重试', success: false,
          });
        }
        assert.equal(unexpected.mock.callCount(), 0);
      });
    }
  }
});

test('divination preserves caller DB identity and the legacy supabase alias', async (t) => {
  for (const authMethod of ['bearer', 'userContext'] as const) {
    for (const aliasOnly of [false, true]) {
      await t.test(`${authMethod} ${aliasOnly ? 'legacy alias' : 'canonical DB'}`, async (t) => {
        const { apiUtils, credits, createCalls, loadPipeline } = setupPipelineMocks(t);
        const inserts: Record<string, unknown>[] = [];
        const caller = createMockAuthContext({
          from: (table: string) => {
            assert.equal(table, 'test_records');
            return { insert: (payload: Record<string, unknown>) => {
              inserts.push(payload);
              return { select: () => ({ single: async () => ({ data: { id: 'record-1' }, error: null }) }) };
            } };
          },
        });
        const other = createMockAuthContext({ from: () => assert.fail('must prefer canonical DB') });
        const context = aliasOnly
          ? { user: caller.user, supabase: caller.db, accessToken: caller.accessToken }
          : { ...caller, supabase: other.db };
        t.mock.method(apiUtils, 'requireBearerUser', async () => context);
        t.mock.method(apiUtils, 'requireUserContext', async () => context);
        const admin = t.mock.method(apiUtils, 'getSystemAdminClient', () => assert.fail('no implicit administrator'));
        const typedCredits = credits as unknown as typeof import('../lib/user/credits');
        const authInfo = t.mock.method(typedCredits, 'getUserAuthInfo');
        const debit = t.mock.method(typedCredits, 'attemptCreditUse');
        const resolvePromptContext = t.mock.fn((_input: unknown, auth: { db: unknown; userId: string; accessToken: string | null }) => {
          assert.equal(auth.db, caller.db);
          assert.equal(auth.userId, caller.user.id);
          assert.equal(auth.accessToken, caller.accessToken);
          return { userId: auth.userId, chartPromptDetailLevel: 'full' as const };
        });
        const config: DivinationRouteConfig = {
          sourceType: 'test_divination', tag: 'test-divination', authMethod,
          parseInput: () => ({}), resolvePromptContext,
          buildPrompts: () => ({ systemPrompt: 'system prompt', userPrompt: 'user prompt' }),
          buildSourceData: () => ({}), generateTitle: () => 'Caller identity',
        };
        const pipeline = loadPipeline();
        const managed = await pipeline.createInterpretHandler(config)(createTestRequest(), {});
        assert.deepEqual(await managed.json(), {
          success: true, data: { analysis: 'analysis', reasoning: 'reason', conversationId: 'conv-1' },
        });
        for (const repository of [authInfo, debit]) {
          assert.equal(repository.mock.callCount(), 1);
          assert.equal(repository.mock.calls[0]?.arguments[1]?.client, caller.db);
          assert.equal(repository.mock.calls[0]?.arguments[1]?.user, caller.user);
        }
        const direct = pipeline.createDirectInterpretHandlers(config);
        assert.equal((await direct.handleDirectPrepare(createTestRequest(), {})).status, 200);
        assert.equal((await direct.handleDirectPersist(createTestRequest(), { content: 'direct analysis' })).status, 200);
        const saved = await pipeline.saveUserOwnedDivinationRecord({
          request: createTestRequest(), tag: 'test-divination', tableName: 'test_records',
          responseKey: 'recordId', input: {}, buildInsertPayload: (_input, userId) => ({ user_id: userId }),
        });
        assert.deepEqual(await saved.json(), { success: true, data: { recordId: 'record-1' } });
        assert.deepEqual(inserts, [{ user_id: caller.user.id }]);
        assert.equal(resolvePromptContext.mock.callCount(), 3);
        assert.equal(createCalls.length, 2, 'named analysis persistence remains available after authentication');
        assert.equal(admin.mock.callCount(), 0);
      });
    }
  }
});

test('divination pipeline returns 500 when credit deduction fails', async (t) => {
  const { credits, loadPipeline } = setupPipelineMocks(t);
  credits.attemptCreditUse = async () => ({
    ok: false,
    reason: 'deduction_failed',
  });

  const { createInterpretHandler } = loadPipeline();
  const handler = createTestHandler(createInterpretHandler);

  const response = await handler(createTestRequest(), { action: 'interpret' });
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, '积分扣减失败，请稍后重试');
});

test('divination pipeline resolves async validation before credit gate', async (t) => {
  const { credits, loadPipeline } = setupPipelineMocks(t);
  let authInfoCalls = 0;
  credits.getUserAuthInfo = async () => {
    authInfoCalls += 1;
    return {
      credits: 0,
      effectiveMembership: 'pro',
      hasCredits: false,
    };
  };

  const { createInterpretHandler } = loadPipeline();
  const handler = createInterpretHandler<Record<string, unknown>, { userId: string; chartPromptDetailLevel: 'full' }>({
    sourceType: 'test_divination',
    tag: 'test-divination',
    parseInput: (body) => (body ?? {}) as Record<string, unknown>,
    resolvePromptContext: async () => ({ error: '缺少前置条件', status: 400 }),
    buildPrompts: () => ({
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
    }),
    buildSourceData: () => ({}),
    generateTitle: () => 'Shared Pipeline Test',
  });

  const response = await handler(createTestRequest(), { action: 'interpret' });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, '缺少前置条件');
  assert.equal(authInfoCalls, 0);
});

test('divination pipeline persists streamed analysis and calls persistRecord after completion', async (t) => {
  const { createCalls, loadPipeline } = setupPipelineMocks(t);
  const persistCalls: Array<{ input: Record<string, unknown>; userId: string; conversationId: string | null }> = [];

  const { createInterpretHandler } = loadPipeline();
  const handler = createTestHandler(createInterpretHandler, async (input, userId, conversationId) => {
    persistCalls.push({ input, userId, conversationId });
  });

  const response = await handler(createTestRequest(), { action: 'interpret', id: 'input-1', stream: true });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
  assert.match(body, /"type":"text-delta","id":"text-1","delta":"analysis"/u);
  assert.ok(createCalls[0], 'createAIAnalysisConversation should be called');
  assert.equal(createCalls[0]?.sourceType, 'test_divination');
  assert.equal(createCalls[0]?.aiResponse, 'analysis');
  assert.equal((createCalls[0]?.sourceData as Record<string, unknown>)?.reasoning_text, 'reason');
  assert.deepEqual(persistCalls, [
    {
      input: { action: 'interpret', id: 'input-1', stream: true },
      userId: 'user-1',
      conversationId: 'conv-1',
    },
  ]);
});

test('divination pipeline surfaces an SSE error when stream persistence fails after content generation', async (t) => {
  const { loadPipeline } = setupPipelineMocks(t);
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });

  const { createInterpretHandler } = loadPipeline();
  const handler = createTestHandler(createInterpretHandler, async () => {
    throw new Error('persist failed');
  });

  const response = await handler(createTestRequest(), { action: 'interpret', stream: true });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /"type":"text-delta","id":"text-1","delta":"analysis"/u);
  assert.match(body, /"type":"error","errorText":"保存结果失败，请稍后重试"/u);
  assert.match(body, /\[DONE\]/u);
});

test('divination pipeline surfaces an SSE error when stream persistence returns null after content generation', async (t) => {
  const { aiAnalysisModule, credits, loadPipeline } = setupPipelineMocks(t);
  const originalConsoleError = console.error;
  let refundCalls = 0;
  console.error = () => {};
  aiAnalysisModule.createAIAnalysisConversation = async () => null;
  credits.refundCreditsOrLog = async () => {
    refundCalls += 1;
    return true;
  };

  t.after(() => {
    console.error = originalConsoleError;
  });

  const { createInterpretHandler } = loadPipeline();
  const handler = createTestHandler(createInterpretHandler);

  const response = await handler(createTestRequest(), { action: 'interpret', stream: true });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /"type":"text-delta","id":"text-1","delta":"analysis"/u);
  assert.match(body, /"type":"error","errorText":"保存结果失败，请稍后重试"/u);
  assert.match(body, /\[DONE\]/u);
  assert.equal(refundCalls, 1);
});

test('divination pipeline refunds and returns 500 when non-stream persistence returns null', async (t) => {
  const { aiAnalysisModule, credits, loadPipeline } = setupPipelineMocks(t);
  const originalConsoleError = console.error;
  let refundCalls = 0;

  console.error = () => {};
  aiAnalysisModule.createAIAnalysisConversation = async () => null;
  credits.refundCreditsOrLog = async () => {
    refundCalls += 1;
    return true;
  };

  t.after(() => {
    console.error = originalConsoleError;
  });

  const { createInterpretHandler } = loadPipeline();
  const handler = createTestHandler(createInterpretHandler);

  const response = await handler(createTestRequest(), { action: 'interpret' });
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, '保存结果失败，请稍后重试');
  assert.equal(refundCalls, 1);
});

test('divination vision pipeline refunds and returns 500 when persistence returns null', async (t) => {
  const { aiAnalysisModule, credits, loadPipeline } = setupPipelineMocks(t);
  const originalConsoleError = console.error;
  let refundCalls = 0;

  console.error = () => {};
  aiAnalysisModule.createAIAnalysisConversation = async () => null;
  credits.refundCreditsOrLog = async () => {
    refundCalls += 1;
    return true;
  };

  t.after(() => {
    console.error = originalConsoleError;
  });

  const { createInterpretHandler } = loadPipeline();
  const handler = createInterpretHandler<Record<string, unknown>>({
    sourceType: 'test_divination',
    tag: 'test-divination',
    isVision: true,
    parseInput: (body) => (body ?? {}) as Record<string, unknown>,
    buildPrompts: () => ({
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
    }),
    buildSourceData: () => ({}),
    generateTitle: () => 'Vision Pipeline Test',
    buildVisionOptions: () => ({
      imageBase64: 'ZmFrZQ==',
      imageMimeType: 'image/png',
    }),
  });

  const response = await handler(createTestRequest(), { action: 'interpret' });
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, '保存结果失败，请稍后重试');
  assert.equal(refundCalls, 1);
});

test('divination pipeline skips persistence when streamed response is aborted', async (t) => {
  const { aiModule, credits, createCalls, loadPipeline } = setupPipelineMocks(t);
  credits.refundCreditsOrLog = async () => { assert.fail('explicit abort must not refund'); };
  const persistCalls: Array<{ conversationId: string | null }> = [];

  aiModule.callAIUIMessageResult = async () => createMockUIMessageResult([
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: 'partial-analysis' },
    { type: 'text-end', id: 'text-1' },
  ], {
    parts: [
      { type: 'text', text: 'partial-analysis', state: 'done' },
    ],
  }, {
    isAborted: true,
    finishReason: 'stop',
  });

  const { createInterpretHandler } = loadPipeline();
  const handler = createTestHandler(createInterpretHandler, async (_input, _userId, conversationId) => {
    persistCalls.push({ conversationId });
  });

  const response = await handler(createTestRequest(), { action: 'interpret', stream: true });
  await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(createCalls, []);
  assert.deepEqual(persistCalls, []);
});

test('divination direct persist reuses server context without rerunning precheck or rebuilding prompts', async (t) => {
  const { createCalls, loadPipeline } = setupPipelineMocks(t);
  let precheckCalls = 0;
  let promptContextCalls = 0;
  let buildPromptsCalls = 0;

  const { createDirectInterpretHandlers } = loadPipeline();
  const handlers = createDirectInterpretHandlers<Record<string, unknown>, InterpretPromptContext & { owner: string }>({
    sourceType: 'test_divination',
    tag: 'test-divination',
    parseInput: (body) => (body ?? {}) as Record<string, unknown>,
    precheck: async () => {
      precheckCalls += 1;
      if (precheckCalls > 1) {
        return { error: '请求过于频繁，请稍后再试', status: 429 };
      }
      return null;
    },
    resolvePromptContext: async (_input, { userId }) => {
      promptContextCalls += 1;
      return { userId, chartPromptDetailLevel: 'full', owner: 'server' };
    },
    buildPrompts: async () => {
      buildPromptsCalls += 1;
      if (buildPromptsCalls > 1) {
        throw new Error('buildPrompts should not be called during direct persist');
      }
      return {
        systemPrompt: 'system prompt',
        userPrompt: 'user prompt',
      };
    },
    buildSourceData: (_input, modelId, reasoningEnabled, promptContext) => ({
      modelId,
      reasoningEnabled,
      promptOwner: promptContext?.owner ?? null,
    }),
    generateTitle: () => 'Shared Pipeline Direct Test',
  });

  const prepareResponse = await handlers.handleDirectPrepare(createTestRequest(), {
    action: 'direct_prepare',
    id: 'input-1',
  });
  const preparePayload = await prepareResponse.json();

  assert.equal(prepareResponse.status, 200);
  assert.equal(preparePayload.data.systemPrompt, 'system prompt');
  assert.equal(preparePayload.data.userPrompt, 'user prompt');

  const persistResponse = await handlers.handleDirectPersist(createTestRequest(), {
    action: 'direct_persist',
    id: 'input-1',
    content: 'analysis',
    reasoningText: 'reason',
    customModelId: 'gpt-4.1-mini',
  });
  const persistPayload = await persistResponse.json();

  assert.equal(persistResponse.status, 200);
  assert.equal(persistPayload.data.conversationId, 'conv-1');
  assert.equal(precheckCalls, 1);
  assert.equal(buildPromptsCalls, 1);
  assert.equal(promptContextCalls, 2);
  assert.equal(createCalls.length, 1);
  assert.equal((createCalls[0]?.sourceData as Record<string, unknown>)?.promptOwner, 'server');
  assert.equal((createCalls[0]?.sourceData as Record<string, unknown>)?.custom_provider, true);
  assert.equal((createCalls[0]?.sourceData as Record<string, unknown>)?.custom_provider_model_id, 'gpt-4.1-mini');
  assert.equal((createCalls[0]?.sourceData as Record<string, unknown>)?.reasoning_text, 'reason');
});

test('persistent stream does not emit finish until persistence settles', async (t) => {
  const { aiAnalysisModule, createCalls, loadPipeline } = setupPipelineMocks(t);
  let release!: () => void;
  let started!: () => void;
  const saving = new Promise<void>((resolve) => { started = resolve; });
  const saved = new Promise<void>((resolve) => { release = resolve; });
  aiAnalysisModule.createAIAnalysisConversation = async (args: Record<string, unknown>) => {
    createCalls.push(args);
    started();
    await saved;
    return 'conv-1';
  };
  const handler = createTestHandler(loadPipeline().createInterpretHandler);
  const response = await handler(createTestRequest(), { stream: true });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let received = '';
  const reading = (async () => {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      received += decoder.decode(next.value);
    }
  })();
  await saving;
  assert.doesNotMatch(received, /"type":"finish"/u);
  release();
  await reading;
  assert.equal(createCalls.length, 1);
  assert.match(received, /"type":"finish"/u);
});

test('stream reasoning-only output refunds once and reports an error before finish', async (t) => {
  const { aiModule, credits, createCalls, loadPipeline } = setupPipelineMocks(t);
  const refunds: unknown[][] = [];
  credits.refundCreditsOrLog = async (...args: unknown[]) => { refunds.push(args); return false; };
  aiModule.callAIUIMessageResult = async () => createMockUIMessageResult([
    { type: 'reasoning-start', id: 'reasoning-1' },
    { type: 'reasoning-delta', id: 'reasoning-1', delta: 'reason only' },
    { type: 'reasoning-end', id: 'reasoning-1' },
  ], { parts: [{ type: 'reasoning', text: 'reason only' }] });
  const handler = createTestHandler(loadPipeline().createInterpretHandler);
  const response = await handler(createTestRequest(), { stream: true });
  const body = await response.text();
  assert.deepEqual(createCalls, []);
  assert.deepEqual(refunds, [['user-1', 1, 'test-divination stream-empty']]);
  assert.match(body, /"errorText":"AI 分析结果为空，请稍后重试"/u);
  assert.ok(body.indexOf('"type":"error"') < body.indexOf('"type":"finish"'));
});

test('stream partial text with an error finish reason retains current save and charge behavior', async (t) => {
  const { aiModule, credits, createCalls, loadPipeline } = setupPipelineMocks(t);
  credits.refundCreditsOrLog = async () => { assert.fail('non-aborted partial text remains billable'); };
  aiModule.callAIUIMessageResult = async () => createMockUIMessageResult([
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: 'partial' },
    { type: 'text-end', id: 'text-1' },
  ], { parts: [{ type: 'text', text: 'partial' }] }, { finishReason: 'error' });
  const handler = createTestHandler(loadPipeline().createInterpretHandler);
  const response = await handler(createTestRequest(), { stream: true });
  const body = await response.text();
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0]?.aiResponse, 'partial');
  assert.match(body, /"type":"finish","finishReason":"error"/u);
});

test('vision retains non-stream response shape and empty-output persistence', async (t) => {
  const { aiModule, credits, createCalls, loadPipeline } = setupPipelineMocks(t);
  aiModule.callAIVision = async () => '';
  credits.refundCreditsOrLog = async () => { assert.fail('vision empty result preserves current charge'); };
  const handler = loadPipeline().createInterpretHandler<Record<string, unknown>>({
    sourceType: 'test_divination', tag: 'test-divination', isVision: true,
    parseInput: () => ({}),
    buildPrompts: () => ({ systemPrompt: '', userPrompt: 'image' }),
    buildSourceData: () => ({}), generateTitle: () => 'Vision',
    buildVisionOptions: () => ({ imageBase64: 'ZmFrZQ==', imageMimeType: 'image/png' }),
    formatSuccessResponse: () => { assert.fail('vision must not use the text response formatter'); },
  });
  const response = await handler(createTestRequest(), { stream: true });
  assert.deepEqual(await response.json(), { success: true, data: { analysis: '', conversationId: 'conv-1' } });
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0]?.aiResponse, '');
});

for (const scenario of ['saved', 'empty', 'aborted', 'inference', 'persistence', 'refund-false', 'refund-throw'] as const) {
  test(`request lifecycle ${scenario} has one correlated safe terminal after settlement`, async t => {
    const state = setupPipelineMocks(t);
    const logs: unknown[][] = [];
    for (const method of ['info', 'warn', 'error', 'log'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
    if (scenario === 'inference') state.aiModule.callAIWithReasoning = async () => { throw new Error('PRIVATE_PROVIDER_PAYLOAD'); };
    if (scenario === 'empty') state.aiModule.callAIWithReasoning = async () => ({ content: '' });
    if (['persistence', 'refund-false', 'refund-throw'].includes(scenario)) state.aiAnalysisModule.createAIAnalysisConversation = async () => { throw new Error('PRIVATE_DATABASE_PAYLOAD'); };
    let refundSettled = false;
    state.credits.refundCreditsOrLog = async () => {
      refundSettled = true;
      if (scenario === 'refund-throw') throw new Error('PRIVATE_REFUND_PAYLOAD');
      return scenario !== 'refund-false';
    };
    if (scenario === 'aborted') state.aiModule.callAIUIMessageResult = async () => createMockUIMessageResult([], { parts: [] }, { isAborted: true });
    const handler = createTestHandler(state.loadPipeline().createInterpretHandler);
    const response = await handler(createTestRequest(), { stream: scenario === 'aborted' });
    await response.text();
    const events = logs.filter(log => log[0] === '[ai-request]').map(log => log[1] as import('../lib/server/analysis').RequestObservationEvent);
    const terminal = events.filter(event => event.phase === 'terminal');
    assert.equal(terminal.length, 1);
    assert.ok(events.every(event => event.requestId === terminal[0].requestId && event.durationMs >= 0));
    assert.notEqual(terminal[0].requestId, 'test-token');
    assert.ok(!JSON.stringify(logs).includes('PRIVATE_'));
    assert.equal(terminal[0].billing, scenario.startsWith('refund-') ? 'refund-failed' : ['saved', 'aborted'].includes(scenario) ? 'charged' : 'refunded');
    assert.equal(refundSettled, !['saved', 'aborted'].includes(scenario));
    if (scenario === 'refund-throw') assert.equal(terminal[0].refundFailure, 'exception');
    if (scenario === 'refund-false') assert.equal(terminal[0].refundFailure, 'rejected');
  });
}

for (const errorKind of ['generic', 'persistence'] as const) {
test(`${errorKind} formatter failure preserves saved analysis refund policy and delays terminal until compensation`, async t => {
  const state = setupPipelineMocks(t);
  const logs: import('../lib/server/analysis').RequestObservationEvent[] = [];
  t.mock.method(console, 'info', (_label: string, event: import('../lib/server/analysis').RequestObservationEvent) => { logs.push(event); });
  let refunds = 0;
  state.credits.refundCreditsOrLog = async () => {
    assert.equal(logs.filter(event => event.phase === 'terminal').length, 0);
    refunds++;
    return true;
  };
  const handler = state.loadPipeline().createInterpretHandler({
    tag: 'formatter-test', sourceType: 'test_divination', parseInput: () => ({}),
    buildPrompts: () => ({ systemPrompt: 'system', userPrompt: 'user' }),
    buildSourceData: () => ({}), generateTitle: () => 'title',
    formatSuccessResponse: () => {
      if (errorKind === 'persistence') {
        const { AIAnalysisConversationPersistenceError } = require('../lib/ai/ai-analysis') as typeof import('../lib/ai/ai-analysis');
        throw new AIAnalysisConversationPersistenceError('tarot', 'formatter failed');
      }
      throw new Error('formatter failed');
    },
  });
  assert.equal((await handler(createTestRequest(), {})).status, 500);
  assert.equal(refunds, 1);
  const terminal = logs.filter(event => event.phase === 'terminal');
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].billing, 'refunded');
  assert.equal(terminal[0].persistence, 'saved');
});
}

test('deferred stream conversion failure records terminal without changing legacy billing', async t => {
  const state = setupPipelineMocks(t);
  const logs: unknown[][] = [];
  for (const method of ['info', 'warn', 'error', 'log'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
  state.aiModule.callAIUIMessageResult = async () => ({ toUIMessageStream: () => { throw new Error('PRIVATE_CONVERSION'); } });
  state.credits.refundCreditsOrLog = async () => assert.fail('deferred conversion never entered legacy completion/refund');
  const handler = createTestHandler(state.loadPipeline().createInterpretHandler);
  const response = await handler(createTestRequest(), { stream: true });
  await response.text();
  assert.equal(state.createCalls.length, 0);
  const events = logs.filter(log => log[0] === '[ai-request]').map(log => log[1] as import('../lib/server/analysis').RequestObservationEvent);
  const terminal = events.filter(event => event.phase === 'terminal');
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].billing, 'charged');
  assert.equal(terminal[0].generation, 'failed');
  assert.equal(terminal[0].persistence, 'not-needed');
  assert.equal(terminal[0].failure, 'stream-adapter');
  assert.ok(!JSON.stringify(logs).includes('PRIVATE_'));
});

for (const direct of [false, true]) {
  test(`${direct ? 'direct' : 'managed'} prompt rejection has a bounded diagnostic`, async t => {
    const state = setupPipelineMocks(t);
    const events: import('../lib/server/analysis').RequestObservationEvent[] = [];
    t.mock.method(console, 'info', (_label: string, event: import('../lib/server/analysis').RequestObservationEvent) => { events.push(event); });
    const pipeline = state.loadPipeline();
    const config = {
      tag: 'prompt-failure', sourceType: 'test_divination', parseInput: () => ({}),
      buildPrompts: () => { throw new Error('PRIVATE_PROMPT'); },
      buildSourceData: () => ({}), generateTitle: () => 'title',
    };
    const response = direct
      ? await pipeline.createDirectInterpretHandlers(config).handleDirectPrepare(createTestRequest(), {})
      : await pipeline.createInterpretHandler(config)(createTestRequest(), {});
    assert.equal(response.status, 500);
    const terminal = events.filter(event => event.phase === 'terminal');
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0].failure, 'prompt');
    assert.equal(terminal[0].billing, direct ? 'not-applicable' : 'refunded');
    assert.ok(!JSON.stringify(events).includes('PRIVATE_'));
  });
}
