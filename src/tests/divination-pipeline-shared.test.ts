import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { mockAIFeatureState } from './helpers/route-mock';
import { createMockAuthContext } from './helpers/auth-mock';
import type { DivinationRouteConfig, InterpretPromptContext } from '../lib/api/divination-pipeline';

const OWN_REF = 'byok:00000000-0000-4000-8000-0000000000b1';

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
  const billing = require('../lib/billing/account.server') as MutableModule;
  const balanceGuard = require('../lib/api/balance-guard') as MutableModule;
  const aiAccess = require('../lib/ai/ai-access') as MutableModule;
  const aiModule = require('../lib/ai/ai') as MutableModule;
  const aiAnalysisModule = require('../lib/ai/ai-analysis') as MutableModule;

  const charges: unknown[] = [];
  const billers: Array<{ userId: string; source: string }> = [];
  const originals = {
    requireUserContext: apiUtils.requireUserContext,
    usageBiller: billing.usageBiller,
    getBalanceGuardResponse: balanceGuard.getBalanceGuardResponse,
    resolveModelAccessAsync: aiAccess.resolveModelAccessAsync,
    callAIWithReasoning: aiModule.callAIWithReasoning,
    callAIUIMessageResult: aiModule.callAIUIMessageResult,
    callAIVision: aiModule.callAIVision,
    createAIAnalysisConversation: aiAnalysisModule.createAIAnalysisConversation,
  };

  apiUtils.requireUserContext = async () => createMockAuthContext();
  billing.usageBiller = (userId: string, source: string) => {
    billers.push({ userId, source });
    return async (report: unknown) => { charges.push(report); };
  };
  balanceGuard.getBalanceGuardResponse = async () => null;
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
    apiUtils.requireUserContext = originals.requireUserContext;
    billing.usageBiller = originals.usageBiller;
    balanceGuard.getBalanceGuardResponse = originals.getBalanceGuardResponse;
    aiAccess.resolveModelAccessAsync = originals.resolveModelAccessAsync;
    aiModule.callAIWithReasoning = originals.callAIWithReasoning;
    aiModule.callAIUIMessageResult = originals.callAIUIMessageResult;
    aiModule.callAIVision = originals.callAIVision;
    aiAnalysisModule.createAIAnalysisConversation = originals.createAIAnalysisConversation;
    delete require.cache[pipelinePath];
  });

  return {
    apiUtils,
    billing,
    balanceGuard,
    access: aiAccess,
    billers,
    charges,
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
  let balanceResponse: Response | null = null;
  const limits = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
  const access = require('../lib/ai/ai-access') as MutableModule;
  access.resolveModelAccessAsync = async () => {
    events.push('model');
    return { modelId: 'test-model', modelConfig: { id: 'test-model', name: 'test', vendor: 'test', modelId: 'test-model', apiUrl: 'https://gateway.example/v1', supportsReasoning: false, pricing: { input: 1, output: 2, cacheRead: null, cacheWrite: null, image: null } }, reasoningEnabled: false };
  };
  state.billing.usageBiller = (userId: string, source: string) => {
    events.push('bill');
    state.billers.push({ userId, source });
    return async (report: unknown) => { state.charges.push(report); };
  };
  state.balanceGuard.getBalanceGuardResponse = async () => {
    events.push('balance');
    return balanceResponse;
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
  return {
    ...state,
    events,
    limits,
    access,
    config,
    setBalanceResponse: (response: Response | null) => { balanceResponse = response; },
  };
}

type AdmissionMode = 'text' | 'vision' | 'stream';
function modeConfig(config: DivinationRouteConfig, mode: AdmissionMode): DivinationRouteConfig {
  return { ...config, isVision: mode === 'vision', buildVisionOptions: () => ({ imageBase64: 'ZmFrZQ==', imageMimeType: 'image/png' }) };
}

for (const mode of ['text', 'vision', 'stream'] as const) {
  test(`${mode} admission orders ownership/model/balance/limit/prompt before inference and save`, async (t) => {
    const state = setupAdmissionMocks(t);
    const handler = state.loadPipeline().createInterpretHandler(modeConfig(state.config, mode));
    const response = await handler(createTestRequest(), { stream: mode === 'stream' });
    await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(state.events, ['parse', 'precheck', 'ownership', 'model', 'balance', 'bill', 'limit', 'prompt', 'infer', 'save']);
    assert.deepEqual(state.billers, [{ userId: 'user-1', source: 'analysis' }]);
  });
}

// Model and balance gates run before the rate slot and prompts; verify each HTTP rejection once.
for (const [failure, status] of [['model', 403], ['balance', 402]] as const) {
  test(`${failure} failure does not consume a rate slot, meter, or assemble prompts`, async (t) => {
    const state = setupAdmissionMocks(t);
    if (failure === 'model') {
      state.access.resolveModelAccessAsync = async () => {
        state.events.push('model');
        return { error: 'model denied', status: 403 };
      };
    } else {
      state.setBalanceResponse(new Response(JSON.stringify({
        success: false, error: '余额不足', code: 'INSUFFICIENT_BALANCE',
      }), { status: 402, headers: { 'Content-Type': 'application/json' } }));
    }
    const response = await state.loadPipeline().createInterpretHandler(state.config)(createTestRequest(), {});
    assert.equal(response.status, status);
    assert.deepEqual(state.events, ['parse', 'precheck', 'ownership', 'model', ...(failure === 'balance' ? ['balance'] : [])]);
    assert.equal(state.createCalls.length, 0);
    assert.deepEqual(state.billers, []);
  });
}

// analysis-use-case.test.ts owns the admission reason matrix. Here retain every HTTP
// mapping and each transport's rejection wiring; metered admission never refunds.
for (const [mode, failure, status, code] of [
  ['text', 'limited', 429, undefined],
  ['vision', 'limited', 429, undefined],
  ['stream', 'limited', 429, undefined],
  ['text', 'rate-error', 500, 'RATE_LIMIT_FAILED'],
  ['stream', 'prompt-error', 500, 'PROMPT_PREPARATION_FAILED'],
  ['vision', 'rate-error', 500, 'RATE_LIMIT_FAILED'],
] as const) {
  test(`${mode} ${failure}: controlled HTTP outcome without inference/save`, async (t) => {
    const state = setupAdmissionMocks(t);
    t.mock.method(state.limits, 'checkRateLimit', async () => {
      state.events.push('limit');
      if (failure === 'rate-error') throw new Error('limiter failed');
      return { allowed: failure !== 'limited', remaining: 0, resetAt: new Date() };
    });
    state.config.buildPrompts = () => { state.events.push('prompt'); throw new Error('prompt failed'); };
    const handler = state.loadPipeline().createInterpretHandler(modeConfig(state.config, mode));
    const response = await handler(createTestRequest(), { stream: mode === 'stream' });
    const payload = await response.json();
    assert.equal(response.status, status);
    assert.equal(payload.code, code);
    assert.deepEqual(state.events, ['parse', 'precheck', 'ownership', 'model', 'balance', 'bill', 'limit', ...(failure === 'prompt-error' ? ['prompt'] : [])]);
    assert.equal(state.createCalls.length, 0);
    // Billing starts only when a metered call reports usage, never for a rejected admission.
    assert.deepEqual(state.charges, []);
  });
}

for (const stage of ['precheck', 'ownership'] as const) {
  test(`ordinary ${stage} rejection remains before model or balance admission`, async (t) => {
    const state = setupAdmissionMocks(t);
    if (stage === 'precheck') state.config.precheck = () => { state.events.push('precheck'); return { error: 'forbidden', status: 403 }; };
    else state.config.resolvePromptContext = () => { state.events.push('ownership'); return { error: 'not found', status: 404 }; };
    const response = await state.loadPipeline().createInterpretHandler(state.config)(createTestRequest(), {});
    assert.equal(response.status, stage === 'precheck' ? 403 : 404);
    assert.deepEqual(state.events, ['parse', 'precheck', ...(stage === 'ownership' ? ['ownership'] : [])]);
  });
}

test('direct prepare skips platform model and balance gates, and persist adds no fee', async (t) => {
  const state = setupAdmissionMocks(t);
  const handlers = state.loadPipeline().createDirectInterpretHandlers(state.config);
  const response = await handlers.handleDirectPrepare(createTestRequest(), {});
  assert.deepEqual(await response.json(), { success: true, data: { systemPrompt: 'system', userPrompt: 'user' } });
  assert.deepEqual(state.events, ['parse', 'precheck', 'ownership', 'limit', 'prompt']);
  assert.deepEqual(state.billers, []);
  state.events.length = 0;
  const missing = await handlers.handleDirectPersist(createTestRequest(), { content: 'browser output', model: 'private-model' });
  assert.equal(missing.status, 400, 'only an own model reference is saved as the reading\'s model');
  state.events.length = 0;
  const saved = await handlers.handleDirectPersist(createTestRequest(), { content: 'browser output', model: OWN_REF });
  assert.equal(saved.status, 200);
  assert.deepEqual(state.events, ['parse', 'ownership', 'save']);
  assert.deepEqual(state.billers, []);
});

for (const failure of ['limited', 'rate-error', 'prompt-error'] as const) {
  test(`direct ${failure} failure never bills`, async (t) => {
    const state = setupAdmissionMocks(t);
    t.mock.method(state.limits, 'checkRateLimit', async () => {
      state.events.push('limit');
      if (failure === 'rate-error') throw new Error('limit failed');
      return { allowed: failure !== 'limited', remaining: 0, resetAt: new Date() };
    });
    state.config.buildPrompts = () => { state.events.push('prompt'); throw new Error('prompt failed'); };
    const response = await state.loadPipeline().createDirectInterpretHandlers(state.config).handleDirectPrepare(createTestRequest(), {});
    const payload = await response.json();
    assert.equal(response.status, failure === 'limited' ? 429 : 500);
    if (failure === 'rate-error') assert.equal(payload.code, 'RATE_LIMIT_FAILED');
    if (failure === 'prompt-error') assert.equal(payload.code, 'PROMPT_PREPARATION_FAILED');
    assert.deepEqual(state.events, ['parse', 'precheck', 'ownership', 'limit', ...(failure === 'prompt-error' ? ['prompt'] : [])]);
    assert.equal(state.createCalls.length, 0);
    assert.deepEqual(state.charges, []);
    assert.deepEqual(state.billers, []);
  });
}

test('divination fails closed when the caller scoped database cannot answer the balance check', async (t) => {
  const { createMockScopedDb } = await import('./helpers/db-mock');
  const invalidContexts = [
    { user: { id: 'user-1' }, db: createMockScopedDb({ tx: async () => { throw new Error('database unavailable'); } }) },
  ];
  for (const [index, authContext] of invalidContexts.entries()) {
      await t.test(`invalid DB context ${index}`, async (t) => {
        const { apiUtils, balanceGuard, aiModule, aiAnalysisModule, loadPipeline } = setupPipelineMocks(t);
        t.mock.method(apiUtils, 'requireUserContext', async () => authContext);
        const unexpected = t.mock.fn(() => assert.fail('invalid identity reached downstream work'));
        t.mock.method(require('../lib/db/context.server'), 'systemDb', unexpected);
        const balance = t.mock.method(balanceGuard, 'getBalanceGuardResponse', async () => new Response(JSON.stringify({
          success: false, error: '读取余额失败，请稍后重试', code: 'BALANCE_UNAVAILABLE',
        }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        for (const name of ['callAIWithReasoning', 'callAIUIMessageResult', 'callAIVision']) {
          t.mock.method(aiModule, name, unexpected);
        }
        t.mock.method(aiAnalysisModule, 'createAIAnalysisConversation', unexpected);
        const config: DivinationRouteConfig = {
          sourceType: 'test_divination', tag: 'test-divination',
          parseInput: () => ({}), precheck: () => null,
          resolvePromptContext: () => ({ userId: 'user-1', chartPromptDetailLevel: 'full' }),
          buildPrompts: () => ({ systemPrompt: 'system', userPrompt: 'user' }),
          buildSourceData: unexpected, generateTitle: unexpected,
          buildHistoryBinding: unexpected, persistRecord: unexpected,
        };
        const pipeline = loadPipeline();
        const managed = pipeline.createInterpretHandler(config);
        const vision = pipeline.createInterpretHandler({ ...config, isVision: true, buildVisionOptions: unexpected });
        const direct = pipeline.createDirectInterpretHandlers(config);
        // Save always uses userContext, independently of the interpret auth default.
        const managedResponses = [
          await managed(createTestRequest(), {}),
          await managed(createTestRequest(), { stream: true }),
          await vision(createTestRequest(), {}),
        ];
        for (const response of managedResponses) {
          assert.equal(response.status, 500);
          assert.deepEqual(await response.json(), {
            error: '读取余额失败，请稍后重试', success: false, code: 'BALANCE_UNAVAILABLE',
          });
        }
        assert.equal(balance.mock.callCount(), 3);
        // BYOK preparation runs on the member's model, so it never reads the platform balance.
        assert.equal((await direct.handleDirectPrepare(createTestRequest(), {})).status, 200);
        const saved = await pipeline.saveUserOwnedDivinationRecord({
          request: createTestRequest(), tag: 'test-divination', tableName: 'test_records',
          responseKey: 'recordId', input: {}, buildInsertPayload: unexpected,
        });
        assert.equal(saved.status, 500);
        assert.deepEqual(await saved.json(), { error: '保存记录失败', success: false });
        assert.equal(unexpected.mock.callCount(), 0);
      });
  }
});

test('divination preserves the caller scoped database identity', async (t) => {
  const { createMockScopedDb } = await import('./helpers/db-mock');
  for (const minimalContext of [false, true]) {
      await t.test(minimalContext ? 'minimal context' : 'full context', async (t) => {
        const { apiUtils, balanceGuard, createCalls, loadPipeline } = setupPipelineMocks(t);
        const inserts: Record<string, unknown>[] = [];
        const callerScoped = createMockScopedDb({
          tx: async (work) => work({
            insertInto(table: string) {
              assert.equal(table, 'test_records');
              return {
                values(payload: Record<string, unknown>) {
                  inserts.push(payload);
                  return { returning() { return { executeTakeFirst: async () => ({ id: 'record-1' }) }; } };
                },
              };
            },
          } as never),
        });
        const callerUser = { id: 'user-1' };
        const context = { user: callerUser, db: callerScoped, accessToken: 'test-token' };
        void minimalContext;
        t.mock.method(apiUtils, 'requireUserContext', async () => context);
        const admin = t.mock.method(require('../lib/db/context.server'), 'systemDb', () => assert.fail('no implicit administrator'));
        const balance = t.mock.method(balanceGuard, 'getBalanceGuardResponse');
        const resolvePromptContext = t.mock.fn((_input: unknown, auth: { db: unknown; userId: string }) => {
          assert.equal(auth.db, callerScoped);
          assert.equal(auth.userId, callerUser.id);
          return { userId: auth.userId, chartPromptDetailLevel: 'full' as const };
        });
        const config: DivinationRouteConfig = {
          sourceType: 'test_divination', tag: 'test-divination',
          parseInput: () => ({}), resolvePromptContext,
          buildPrompts: () => ({ systemPrompt: 'system prompt', userPrompt: 'user prompt' }),
          buildSourceData: () => ({}), generateTitle: () => 'Caller identity',
        };
        const pipeline = loadPipeline();
        const managed = await pipeline.createInterpretHandler(config)(createTestRequest(), {});
        assert.deepEqual(await managed.json(), {
          success: true, data: { analysis: 'analysis', reasoning: 'reason', conversationId: 'conv-1' },
        });
        assert.equal(balance.mock.callCount(), 1);
        assert.equal(balance.mock.calls[0]?.arguments[0], callerUser.id);
        assert.equal(balance.mock.calls[0]?.arguments[2], callerScoped);
        const direct = pipeline.createDirectInterpretHandlers(config);
        assert.equal((await direct.handleDirectPrepare(createTestRequest(), {})).status, 200);
        assert.equal((await direct.handleDirectPersist(createTestRequest(), { content: 'direct analysis', model: OWN_REF })).status, 200);
        const saved = await pipeline.saveUserOwnedDivinationRecord({
          request: createTestRequest(), tag: 'test-divination', tableName: 'test_records',
          responseKey: 'recordId', input: {}, buildInsertPayload: (_input, userId) => ({ user_id: userId }),
        });
        assert.deepEqual(await saved.json(), { success: true, data: { recordId: 'record-1' } });
        assert.deepEqual(inserts, [{ user_id: callerUser.id }]);
        assert.equal(resolvePromptContext.mock.callCount(), 3);
        assert.equal(createCalls.length, 2, 'named analysis persistence remains available after authentication');
        assert.equal(admin.mock.callCount(), 0);
      });
  }
});

test('divination pipeline charges the metered usage the model call reports', async (t) => {
  const { aiModule, billers, charges, loadPipeline } = setupPipelineMocks(t);
  const usage = { inputTokens: 120, outputTokens: 30, totalTokens: 150 };
  aiModule.callAIWithReasoning = async (
    _messages: unknown, modelId: unknown, _prefix: unknown, options: unknown,
  ) => {
    assert.equal(modelId, 'test-model');
    await (options as { onUsage?: (report: unknown) => Promise<void> }).onUsage?.({
      model: { id: 'test-model', pricing: { input: 1, output: 2 } }, usage,
    });
    return { content: 'analysis', reasoning: 'reason' };
  };
  const handler = createTestHandler(loadPipeline().createInterpretHandler);
  const response = await handler(createTestRequest(), { action: 'interpret' });
  assert.equal(response.status, 200);
  assert.deepEqual(billers, [{ userId: 'user-1', source: 'analysis' }]);
  assert.deepEqual(charges, [{
    model: { id: 'test-model', pricing: { input: 1, output: 2 } }, usage,
  }]);
});

test('divination pipeline resolves async validation before model or balance admission', async (t) => {
  const { access, balanceGuard, loadPipeline } = setupPipelineMocks(t);
  const model = t.mock.method(access, 'resolveModelAccessAsync');
  const balance = t.mock.method(balanceGuard, 'getBalanceGuardResponse');

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
  assert.equal(model.mock.callCount(), 0);
  assert.equal(balance.mock.callCount(), 0);
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
  const { aiAnalysisModule, charges, loadPipeline } = setupPipelineMocks(t);
  const originalConsoleError = console.error;
  console.error = () => {};
  aiAnalysisModule.createAIAnalysisConversation = async () => null;

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
  assert.deepEqual(charges, []);
});

test('divination pipeline returns 500 when non-stream persistence returns null', async (t) => {
  const { aiAnalysisModule, charges, loadPipeline } = setupPipelineMocks(t);
  const originalConsoleError = console.error;

  console.error = () => {};
  aiAnalysisModule.createAIAnalysisConversation = async () => null;

  t.after(() => {
    console.error = originalConsoleError;
  });

  const { createInterpretHandler } = loadPipeline();
  const handler = createTestHandler(createInterpretHandler);

  const response = await handler(createTestRequest(), { action: 'interpret' });
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, '保存结果失败，请稍后重试');
  assert.deepEqual(charges, []);
});

test('divination vision pipeline returns 500 when persistence returns null', async (t) => {
  const { aiAnalysisModule, charges, loadPipeline } = setupPipelineMocks(t);
  const originalConsoleError = console.error;

  console.error = () => {};
  aiAnalysisModule.createAIAnalysisConversation = async () => null;

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
  assert.deepEqual(charges, []);
});

test('divination pipeline skips persistence when streamed response is aborted', async (t) => {
  const { aiModule, charges, createCalls, loadPipeline } = setupPipelineMocks(t);
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
  assert.deepEqual(charges, []);
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
    model: OWN_REF.toUpperCase().replace('BYOK:', 'byok:'),
  });
  const persistPayload = await persistResponse.json();

  assert.equal(persistResponse.status, 200);
  assert.equal(persistPayload.data.conversationId, 'conv-1');
  assert.equal(precheckCalls, 1);
  assert.equal(buildPromptsCalls, 1);
  assert.equal(promptContextCalls, 2);
  assert.equal(createCalls.length, 1);
  assert.equal((createCalls[0]?.sourceData as Record<string, unknown>)?.promptOwner, 'server');
  assert.equal((createCalls[0]?.sourceData as Record<string, unknown>)?.modelId, OWN_REF, 'the reading names the own model by its reference');
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

test('stream reasoning-only output reports an error before finish without saving or charging', async (t) => {
  const { aiModule, charges, createCalls, loadPipeline } = setupPipelineMocks(t);
  aiModule.callAIUIMessageResult = async () => createMockUIMessageResult([
    { type: 'reasoning-start', id: 'reasoning-1' },
    { type: 'reasoning-delta', id: 'reasoning-1', delta: 'reason only' },
    { type: 'reasoning-end', id: 'reasoning-1' },
  ], { parts: [{ type: 'reasoning', text: 'reason only' }] });
  const handler = createTestHandler(loadPipeline().createInterpretHandler);
  const response = await handler(createTestRequest(), { stream: true });
  const body = await response.text();
  assert.deepEqual(createCalls, []);
  assert.deepEqual(charges, []);
  assert.match(body, /"errorText":"AI 分析结果为空，请稍后重试"/u);
  assert.ok(body.indexOf('"type":"error"') < body.indexOf('"type":"finish"'));
});

test('stream partial text with an error finish reason retains current save behavior', async (t) => {
  const { aiModule, createCalls, loadPipeline } = setupPipelineMocks(t);
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
  const { aiModule, createCalls, loadPipeline } = setupPipelineMocks(t);
  aiModule.callAIVision = async () => '';
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

for (const scenario of ['saved', 'empty', 'aborted', 'inference', 'persistence', 'rejected'] as const) {
  test(`request lifecycle ${scenario} has one correlated safe terminal after settlement`, async t => {
    const state = setupPipelineMocks(t);
    const logs: unknown[][] = [];
    for (const method of ['info', 'warn', 'error', 'log'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
    if (scenario === 'inference') state.aiModule.callAIWithReasoning = async () => { throw new Error('PRIVATE_PROVIDER_PAYLOAD'); };
    if (scenario === 'empty') state.aiModule.callAIWithReasoning = async () => ({ content: '' });
    if (scenario === 'persistence') state.aiAnalysisModule.createAIAnalysisConversation = async () => { throw new Error('PRIVATE_DATABASE_PAYLOAD'); };
    if (scenario === 'rejected') {
      state.balanceGuard.getBalanceGuardResponse = async () => new Response(JSON.stringify({
        success: false, error: '余额不足', code: 'INSUFFICIENT_BALANCE',
      }), { status: 402, headers: { 'Content-Type': 'application/json' } });
    }
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
    assert.equal(terminal[0].billing, scenario === 'rejected' ? 'not-applicable' : 'metered');
    const expectedFailure: Partial<Record<typeof scenario, string>> = {
      empty: 'empty', inference: 'inference', persistence: 'persistence', rejected: 'admission',
    };
    assert.equal(terminal[0].failure, expectedFailure[scenario] ?? 'none');
    assert.deepEqual(state.charges, []);
  });
}

for (const errorKind of ['generic', 'persistence'] as const) {
test(`${errorKind} formatter failure keeps the saved analysis and its metered terminal`, async t => {
  const state = setupPipelineMocks(t);
  const logs: import('../lib/server/analysis').RequestObservationEvent[] = [];
  t.mock.method(console, 'info', (_label: string, event: import('../lib/server/analysis').RequestObservationEvent) => { logs.push(event); });
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
  assert.equal(state.createCalls.length, 1);
  assert.deepEqual(state.charges, []);
  const terminal = logs.filter(event => event.phase === 'terminal');
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].billing, 'metered');
  assert.equal(terminal[0].persistence, 'saved');
});
}

test('deferred stream conversion failure records terminal without charging', async t => {
  const state = setupPipelineMocks(t);
  const logs: unknown[][] = [];
  for (const method of ['info', 'warn', 'error', 'log'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
  state.aiModule.callAIUIMessageResult = async () => ({ toUIMessageStream: () => { throw new Error('PRIVATE_CONVERSION'); } });
  const handler = createTestHandler(state.loadPipeline().createInterpretHandler);
  const response = await handler(createTestRequest(), { stream: true });
  await response.text();
  assert.equal(state.createCalls.length, 0);
  assert.deepEqual(state.charges, []);
  const events = logs.filter(log => log[0] === '[ai-request]').map(log => log[1] as import('../lib/server/analysis').RequestObservationEvent);
  const terminal = events.filter(event => event.phase === 'terminal');
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].billing, 'metered');
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
    assert.equal(terminal[0].billing, direct ? 'not-applicable' : 'metered');
    assert.ok(!JSON.stringify(events).includes('PRIVATE_'));
  });
}
