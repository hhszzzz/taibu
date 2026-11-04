/**
 * 占卜路由工厂
 *
 * 共享准入与生成流水线：
 * 1. Auth (requireUserContext)
 * 2. Ordinary route precheck + owned-resource context validation
 * 3. Model admission, then a positive balance
 * 4. Endpoint rate admission
 * 5. Final prompt assembly
 * 6. AI call (stream / non-stream, text / vision), billed for its usage when it ends
 * 7. Persist conversation
 */

import { type NextRequest } from 'next/server';
import { createUIMessageStream, createUIMessageStreamResponse, type FinishReason } from 'ai';
import {
  jsonError,
  jsonOk,
  requireUserContext,
  SSE_HEADERS,
} from '@/lib/api-utils';
import { userDb, type ScopedDb } from '@/lib/db/context.server';
import { insertIntoDynamic } from '@/lib/db/sql-helpers';
import { usageBiller } from '@/lib/billing/account.server';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { resolveModelAccessAsync } from '@/lib/ai/ai-access';
import { callAIWithReasoning, callAIUIMessageResult, callAIVision } from '@/lib/ai/ai';
import {
  AIAnalysisConversationPersistenceError,
  createAIAnalysisConversation,
} from '@/lib/ai/ai-analysis';
import { extractAIErrorMessage } from '@/lib/ai/ai-error';
import {
  createManagedAnalysisCompletion,
  createRequestObservation,
  type RequestObservation,
  persistDirectAnalysis,
  prepareAnalysis,
  prepareAdmittedAnalysis,
  runManagedAnalysis,
  type CompleteManagedAnalysis,
  type ManagedAnalysisOutcome,
} from '@/lib/server/analysis';
import type { AIReasoningEffort } from '@/types';
import type { ChartType } from '@/lib/visualization/chart-types';
import { buildVisualizationPromptSection } from '@/lib/visualization/prompt';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { getBalanceGuardResponse } from '@/lib/api/balance-guard';
import { AI_RATE_LIMIT_CONFIG, checkRateLimit } from '@/lib/rate-limit';
import { parseReasoningEffort } from '@/lib/chat/model-settings';
import { ByokRequestError, byokFailureFromMessage, byokRef, byokThinking, isByokRef, parseByokRef } from '@/lib/byok/config';
import { byokGate } from '@/lib/byok/api.server';
import { runServerByok, serverByokModel } from '@/lib/byok/chat.server';

// ─── Types ───

export interface InterpretInput {
  /** Raw parsed body fields — shape is route-specific */
  [key: string]: unknown;
}

export interface InterpretPrompts {
  systemPrompt: string;
  userPrompt: string;
}

export interface InterpretPromptContext {
  userId: string;
  chartPromptDetailLevel: ChartTextDetailLevel;
  [key: string]: unknown;
}

type UserContextAuthResult = Extract<
  Awaited<ReturnType<typeof requireUserContext>>,
  { user: { id: string } }
>;

export type DivinationAuthContext = {
  userId: string;
  db: ScopedDb;
};

type SuccessfulDivinationAuthResult = {
  user: { id: string };
  db?: UserContextAuthResult['db'];
};

function scopedDbFor(result: { user: { id: string }; db?: ScopedDb }): ScopedDb {
  return result.db ?? userDb(result.user.id);
}

type RouteError = { error: string; status: number };

function isRouteError(value: unknown): value is RouteError {
  return Boolean(value && typeof value === 'object' && 'error' in value && 'status' in value);
}

type SaveUserOwnedRecordOptions<TInput, TResponseKey extends string> = {
  request: NextRequest;
  tag: string;
  tableName: string;
  responseKey: TResponseKey;
  input: TInput;
  validate?: (input: TInput) => RouteError | null;
  buildInsertPayload: (input: TInput, userId: string) => Record<string, unknown>;
  successStatus?: number;
  errorMessage?: string;
};

type PersistUserOwnedRecordOptions<TInput> = {
  db: ScopedDb;
  tag: string;
  tableName: string;
  input: TInput;
  userId: string;
  buildInsertPayload: (input: TInput, userId: string) => Record<string, unknown>;
  errorMessage?: string;
};

export async function persistUserOwnedDivinationRecord<
  TInput,
>({
  db,
  tag,
  tableName,
  input,
  userId,
  buildInsertPayload,
  errorMessage = '保存记录失败',
}: PersistUserOwnedRecordOptions<TInput>): Promise<{ id: string | null; error: string | null }> {
  try {
    const row = await db.tx((trx) => insertIntoDynamic(trx, tableName)
      .values(buildInsertPayload(input, userId))
      .returning('id')
      .executeTakeFirst());
    return {
      id: typeof row?.id === 'string' ? row.id : null,
      error: null,
    };
  } catch (error) {
    console.error(`[${tag}] ${errorMessage}:`, error instanceof Error ? error.message : error);
    return {
      id: null,
      error: errorMessage,
    };
  }
}

export async function saveUserOwnedDivinationRecord<
  TInput,
  TResponseKey extends string,
>({
  request,
  tag,
  tableName,
  responseKey,
  input,
  validate,
  buildInsertPayload,
  successStatus = 200,
  errorMessage = '保存记录失败',
}: SaveUserOwnedRecordOptions<TInput, TResponseKey>): Promise<Response> {
  const validationError = validate?.(input);
  if (validationError) {
    return jsonError(validationError.error, validationError.status, { success: false });
  }

  const authResult = await requireUserContext(request);
  if ('error' in authResult) {
    return jsonError(authResult.error.message, authResult.error.status, { success: false });
  }

  const db = scopedDbFor(authResult);

  const { id, error } = await persistUserOwnedDivinationRecord({
    db,
    tag,
    tableName,
    input,
    userId: authResult.user.id,
    buildInsertPayload,
    errorMessage,
  });

  if (error) {
    return jsonError(errorMessage, 500, { success: false });
  }

  return jsonOk({
    success: true,
    data: {
      [responseKey]: id,
    },
  }, successStatus);
}

export interface DivinationRouteConfig<
  T extends InterpretInput = InterpretInput,
  TContext extends InterpretPromptContext = InterpretPromptContext,
> {
  /** conversations.source_type */
  sourceType: string | ((input: T, context?: TContext) => string);
  /** Log tag, e.g. 'tarot', 'liuyao' */
  tag: string;
  /** Parse & validate the request body. Return parsed input or an error. */
  parseInput: (body: unknown) => T | RouteError;
  /** Resource/business precheck before model and balance admission; never a rate limiter. */
  precheck?: (request: NextRequest, input: T, userId: string) => Promise<RouteError | null> | RouteError | null;
  /** Overrides the default user/path 20/min limit after model and balance admission.
   * Not run for direct persist or ordinary save actions. */
  postAdmissionRateLimit?: (request: NextRequest, input: T, userId: string) => Promise<RouteError | null> | RouteError | null;
  /** Build system + user prompts from parsed input. */
  buildPrompts: (input: T, context?: TContext) => InterpretPrompts | Promise<InterpretPrompts>;
  /** Optional prompt context resolver (used for user settings such as chart prompt detail level). */
  resolvePromptContext?: (input: T, auth: DivinationAuthContext) => Promise<TContext | RouteError> | TContext | RouteError;
  /** Build source_data for createAIAnalysisConversation. */
  buildSourceData: (input: T, modelId: string, reasoningEnabled: boolean, context?: TContext) => Record<string, unknown>;
  /** Generate conversation title. */
  generateTitle: (input: T, context?: TContext) => string;
  /** Default model ID (defaults to DEFAULT_MODEL_ID). */
  defaultModelId?: string;
  /** Whether this is a vision route (face/palm). */
  isVision?: boolean;
  /** Vision-specific options builder. Only used when isVision=true. */
  buildVisionOptions?: (input: T) => { imageBase64: string; imageMimeType: string };
  /** resolveModelAccessAsync extra options (e.g. requireVision). */
  modelAccessOptions?: {
    requireVision?: boolean;
  };
  /** 该路由允许 AI 输出的内置图表类型。传入后会追加统一的「可视化」提示段（内置图表 + 沙箱 HTML）。 */
  allowedChartTypes?: ChartType[] | ((input: T, context?: TContext) => ChartType[]);
  /** Empty AI result message. */
  emptyResultMessage?: string;
  /** Custom success response shape for non-stream routes. */
  formatSuccessResponse?: (result: {
    content: string;
    reasoning: string | null;
    conversationId: string | null;
  }) => Record<string, unknown>;
  /**
   * Optional transaction payload builder.
   * When provided, conversation persistence and record binding happen in one DB transaction.
   */
  buildHistoryBinding?: (
    input: T,
    userId: string,
    context?: TContext,
  ) => Parameters<typeof createAIAnalysisConversation>[0]['historyBinding'];
  /**
   * Optional post-persist hook. Called after conversation is created.
   * Keep this only for paths that do not need multi-write transactional persistence.
   */
  persistRecord?: (
    input: T,
    userId: string,
    conversationId: string | null,
    context?: TContext,
  ) => Promise<void>;
}

async function prepareInterpretAnalysis<T extends InterpretInput, TContext extends InterpretPromptContext>(
  config: DivinationRouteConfig<T, TContext>,
  input: T,
  userId: string,
  context?: TContext,
) {
  return prepareAnalysis({ actor: { userId }, input, context }, {
    buildPrompts: config.buildPrompts,
    buildOutputContract: (input, context) => {
      const chartTypes = typeof config.allowedChartTypes === 'function'
        ? config.allowedChartTypes(input, context)
        : config.allowedChartTypes;
      return (chartTypes?.length ? buildVisualizationPromptSection(chartTypes) : '') || undefined;
    },
  });
}

async function prepareAdmittedInterpretAnalysis<T extends InterpretInput, TContext extends InterpretPromptContext>(
  config: DivinationRouteConfig<T, TContext>,
  request: NextRequest,
  input: T,
  userId: string,
  context: TContext | undefined,
  direct: boolean,
  observation?: RequestObservation,
) {
  const rejection: { value: RouteError | null } = { value: null };
  const result = await prepareAdmittedAnalysis({
    observation,
    checkRateLimit: async () => {
      if (config.postAdmissionRateLimit) {
        rejection.value = await config.postAdmissionRateLimit(request, input, userId);
      } else {
        const limit = await checkRateLimit(userId, request.nextUrl.pathname, AI_RATE_LIMIT_CONFIG);
        rejection.value = limit.allowed ? null : { error: '请求过于频繁，请稍后再试', status: 429 };
      }
      return rejection.value === null;
    },
    prepare: () => prepareInterpretAnalysis(config, input, userId, context),
  });
  if (result.ok) return result.value;

  observation?.finish();
  if (result.reason === 'limited') {
    return jsonError(rejection.value?.error ?? '请求过于频繁，请稍后再试', rejection.value?.status ?? 429, { success: false });
  }
  if (result.reason === 'rate-error') {
    return jsonError('请求限流检查失败，请稍后重试', 500, { success: false, code: 'RATE_LIMIT_FAILED' });
  }
  return jsonError(direct ? '生成直连上下文失败，请稍后重试' : '生成分析上下文失败，请稍后重试', 500, {
    success: false, code: 'PROMPT_PREPARATION_FAILED',
  });
}

export interface PersistentStreamResult {
  error?: string | null;
}

function toDivinationAuthContext(
  authResult: SuccessfulDivinationAuthResult,
): DivinationAuthContext {
  return {
    userId: authResult.user.id,
    db: scopedDbFor(authResult),
  };
}

export function createPersistentStreamResponse({
  streamResult,
  onStreamComplete,
  onStreamAbort,
  onStreamAdapterFailure,
}: {
  streamResult: Awaited<ReturnType<typeof callAIUIMessageResult>>;
  onStreamComplete: (result: { content: string; reasoning: string | null }) => Promise<PersistentStreamResult>;
  onStreamAbort?: () => Promise<unknown>;
  onStreamAdapterFailure?: () => void;
}): Response {
  const uiStream = createUIMessageStream({
    execute: async ({ writer }) => {
      const finishPromise = new Promise<{
        finishReason?: FinishReason;
        persistenceError?: string | null;
        aborted: boolean;
      }>((resolve) => {
        writer.merge(streamResult.toUIMessageStream({
        sendReasoning: true,
        sendSources: false,
        sendStart: false,
        sendFinish: false,
        onFinish: async ({ responseMessage, finishReason, isAborted }) => {
          if (isAborted) {
            await onStreamAbort?.();
            resolve({ finishReason, aborted: true });
            return;
          }

          try {
            let content = '';
            let reasoning = '';

            for (const part of responseMessage.parts) {
              if (part.type === 'text') {
                content += part.text;
              } else if (part.type === 'reasoning') {
                reasoning += part.text;
              }
            }

            const persistenceResult = await onStreamComplete({
              content,
              reasoning: reasoning || null,
            });

            resolve({
              finishReason,
              persistenceError: persistenceResult.error ?? null,
              aborted: false,
            });
          } catch {
            resolve({
              finishReason,
              persistenceError: '保存结果失败，请稍后重试',
              aborted: false,
            });
          }
        },
      }));
      });

      let finishResult;
      try {
        finishResult = await finishPromise;
      } catch (error) {
        // Conversion runs after Response construction: preserve its legacy no-completion
        // billing path, but do not lose the request terminal observation.
        onStreamAdapterFailure?.();
        throw error;
      }
      if (finishResult.aborted) {
        return;
      }
      if (finishResult.persistenceError) {
        writer.write({ type: 'error', errorText: finishResult.persistenceError });
      }
      writer.write({ type: 'finish', finishReason: finishResult.finishReason });
    },
  });

  return createUIMessageStreamResponse({
    stream: uiStream,
    headers: {
      ...SSE_HEADERS,
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Readings on the member's own model whose key stays in their browser: this site prepares the prompts and saves the
 * result, the browser sends the photo to the provider.
 */
export function createDirectInterpretHandlers<
  T extends InterpretInput,
  TContext extends InterpretPromptContext = InterpretPromptContext,
>(
  config: DivinationRouteConfig<T, TContext>,
) {
  const {
    sourceType,
    tag,
    parseInput,
    precheck,
    resolvePromptContext,
    buildSourceData,
    generateTitle,
    buildHistoryBinding,
    persistRecord,
    emptyResultMessage = 'AI 分析结果为空，请稍后重试',
  } = config;

  type ResolvedPreparedBase = {
    input: T;
    userId: string;
    promptContext?: TContext;
  };

  type ResolvedPreparedWithPrompts = ResolvedPreparedBase & {
    systemPrompt: string;
    userPrompt: string;
  };

  const resolvePrepared = async (
    request: NextRequest,
    body: Record<string, unknown>,
    options: {
      runPrecheck: boolean;
      includePrompts: boolean;
      observation?: RequestObservation;
    },
  ): Promise<Response | ResolvedPreparedBase | ResolvedPreparedWithPrompts> => {
    const { runPrecheck, includePrompts } = options;
    const featureGuardResponse = await getGlobalAIFeatureGuardResponse() ?? await byokGate();
    if (featureGuardResponse) return featureGuardResponse;

    const parsed = parseInput(body);
    if (isRouteError(parsed)) {
      return jsonError(parsed.error, parsed.status, { success: false });
    }
    const input = parsed as T;

    const authResult = await requireUserContext(request);
    if ('error' in authResult) {
      return jsonError(authResult.error.message, authResult.error.status, { success: false });
    }
    const authContext = toDivinationAuthContext(authResult);
    if (isRouteError(authContext)) {
      return jsonError(authContext.error, authContext.status, { success: false });
    }

    if (runPrecheck) {
      const precheckResult = precheck ? await precheck(request, input, authResult.user.id) : null;
      if (precheckResult) {
        return jsonError(precheckResult.error, precheckResult.status, { success: false });
      }
    }

    const promptContextResult = resolvePromptContext
      ? await resolvePromptContext(input, authContext)
      : undefined;
    if (isRouteError(promptContextResult)) {
      return jsonError(promptContextResult.error, promptContextResult.status, { success: false });
    }
    const promptContext = promptContextResult as TContext | undefined;

    if (!includePrompts) {
      return {
        input,
        userId: authContext.userId,
        promptContext,
      };
    }

    // The member's own model: no platform model or balance gate.
    const prepared = await prepareAdmittedInterpretAnalysis(
      config, request, input, authContext.userId, promptContext, true, options.observation,
    );
    if (prepared instanceof Response) return prepared;
    const { prompts: { systemPrompt, userPrompt } } = prepared;

    return {
      input,
      userId: authContext.userId,
      promptContext,
      systemPrompt,
      userPrompt,
    };
  };

  const persistPreparedResult = async ({
    input,
    userId,
    promptContext,
    content,
    reasoningText,
    modelRef,
  }: {
    input: T;
    userId: string;
    promptContext?: TContext;
    content: string;
    reasoningText: string | null;
    modelRef: string;
  }): Promise<string> => {
    const sourceData = buildSourceData(input, modelRef, false, promptContext);
    if (reasoningText) {
      sourceData.reasoning_text = reasoningText;
    }

    const resolvedSourceType = typeof sourceType === 'function'
      ? sourceType(input, promptContext)
      : sourceType;
    const conversationId = await createAIAnalysisConversation({
      userId,
      sourceType: resolvedSourceType as Parameters<typeof createAIAnalysisConversation>[0]['sourceType'],
      sourceData,
      title: generateTitle(input, promptContext),
      aiResponse: content,
      historyBinding: buildHistoryBinding
        ? buildHistoryBinding(input, userId, promptContext)
        : null,
    });

    if (typeof conversationId !== 'string' || conversationId.trim().length === 0) {
      throw new AIAnalysisConversationPersistenceError(
        resolvedSourceType as Parameters<typeof createAIAnalysisConversation>[0]['sourceType'],
        'createAIAnalysisConversation returned an invalid conversation id',
      );
    }

    if (persistRecord) {
      await persistRecord(input, userId, conversationId, promptContext);
    }

    return conversationId;
  };

  return {
    async handleDirectPrepare(
      request: NextRequest,
      body: Record<string, unknown>,
    ): Promise<Response> {
      const observation = createRequestObservation(crypto.randomUUID(), `${tag}:direct-prepare`, () => performance.now(), event => console.info('[ai-request]', event));
      try {
        const prepared = await resolvePrepared(request, body, {
          runPrecheck: true,
          includePrompts: true,
          observation,
        });
        if (prepared instanceof Response) {
          observation.fail('admission');
          return prepared;
        }
        if (!('systemPrompt' in prepared) || !('userPrompt' in prepared)) {
          observation.fail('prompt');
          return jsonError('生成直连上下文失败，请稍后重试', 500, { success: false });
        }

        return jsonOk({
          success: true,
          data: {
            systemPrompt: prepared.systemPrompt,
            userPrompt: prepared.userPrompt,
          },
        });
      } catch {
        observation.fail();
        return jsonError('生成直连上下文失败，请稍后重试', 500, { success: false });
      } finally {
        observation.finish();
      }
    },

    async handleDirectPersist(
      request: NextRequest,
      body: Record<string, unknown>,
    ): Promise<Response> {
      const observation = createRequestObservation(crypto.randomUUID(), `${tag}:direct-persist`, () => performance.now(), event => console.info('[ai-request]', event));
      observation.update({ generation: 'external' });
      try {
        const prepared = await resolvePrepared(request, body, {
          runPrecheck: false,
          includePrompts: false,
        });
        if (prepared instanceof Response) {
          return prepared;
        }
        const modelId = parseByokRef(body.model);
        if (!modelId) return jsonError('缺少自定义模型', 400, { success: false });

        const content = typeof body.content === 'string' ? body.content : '';
        const reasoningText = typeof body.reasoningText === 'string'
          ? body.reasoningText
          : typeof body.reasoning === 'string'
            ? body.reasoning
            : null;

        observation.phase('persistence');
        const outcome = await persistDirectAnalysis({ content, reasoning: reasoningText }, (output) =>
          persistPreparedResult({
            input: prepared.input,
            userId: prepared.userId,
            promptContext: prepared.promptContext,
            content: output.content,
            reasoningText: output.reasoning ?? null,
            modelRef: byokRef(modelId),
          }));
        observation.finish(outcome);
        if (outcome.status === 'empty') {
          return jsonError(emptyResultMessage, 400, { success: false });
        }
        if (outcome.status === 'failed') {
          return jsonError('保存结果失败，请稍后重试', 500, { success: false });
        }
        return jsonOk({ success: true, data: { conversationId: outcome.conversationId } });
      } finally {
        observation.finish();
      }
    },
  };
}

// ─── Factory ───

/**
 * Create a POST handler that runs the shared interpret pipeline.
 *
 * The returned handler:
 * 1. Authenticates via Bearer token
 * 2. Runs ordinary prechecks and validates owned-resource context
 * 3. Resolves model access, then requires a positive balance
 * 4. Applies the endpoint rate policy
 * 5. Builds final prompts only after admission
 * 6. Calls AI (stream or non-stream; text or vision), which bills its usage when it ends
 * 7. Persists the conversation
 */
export function createInterpretHandler<
  T extends InterpretInput,
  TContext extends InterpretPromptContext = InterpretPromptContext,
>(
  config: DivinationRouteConfig<T, TContext>,
) {
  const {
    sourceType,
    tag,
    parseInput,
    precheck,
    resolvePromptContext,
    buildSourceData,
    generateTitle,
    defaultModelId = DEFAULT_MODEL_ID,
    isVision = false,
    buildVisionOptions,
    modelAccessOptions,
    emptyResultMessage = 'AI 分析结果为空，请稍后重试',
    formatSuccessResponse,
    buildHistoryBinding,
    persistRecord,
  } = config;

  return async function handleInterpret(
    request: NextRequest,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const observation = createRequestObservation(crypto.randomUUID(), tag, () => performance.now(), event => console.info('[ai-request]', event));
    let completionOwnsTerminal = false;
    try {
      const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
      if (featureGuardResponse) {
        observation.fail('admission');
        return featureGuardResponse;
      }

      // Parse input first (fast fail for invalid params)
      const parsed = parseInput(body);
      if (isRouteError(parsed)) {
        observation.fail('admission');
        return jsonError(parsed.error, parsed.status, { success: false });
      }
      const input = parsed as T;

      // 1. Auth
      const authResult = await requireUserContext(request);
      if ('error' in authResult) {
        observation.fail('admission');
        return jsonError(authResult.error.message, authResult.error.status, { success: false });
      }
      const { user } = authResult;
      const authContext = toDivinationAuthContext(authResult);
      if (isRouteError(authContext)) {
        observation.fail('admission');
        return jsonError(authContext.error, authContext.status, { success: false });
      }

      const precheckResult = precheck ? await precheck(request, input, user.id) : null;
      if (precheckResult) {
        observation.fail('admission');
        return jsonError(precheckResult.error, precheckResult.status, { success: false });
      }

      const promptContextResult = resolvePromptContext
        ? await resolvePromptContext(input, authContext)
        : undefined;
      if (isRouteError(promptContextResult)) {
        observation.fail('admission');
        return jsonError(promptContextResult.error, promptContextResult.status, { success: false });
      }
      const promptContext = promptContextResult as TContext | undefined;

      // 2. Model admission precedes the balance decision.
      const modelId = (body.modelId as string | undefined);
      const reasoning = (body.reasoning as boolean | undefined);
      const stream = (body.stream as boolean | undefined);
      if (isByokRef(modelId)) {
        return await handleByokAnalysis(request, body, modelId, input, user.id, authContext.db, promptContext, observation);
      }
      const access = await resolveModelAccessAsync(modelId, defaultModelId, reasoning, modelAccessOptions);
      if ('error' in access) {
        observation.fail('admission');
        return jsonError(access.error, access.status, { success: false });
      }
      const { modelId: resolvedModelId, modelConfig, reasoningEnabled } = access;

      // 3. A positive balance admits the call; the call pays for its usage when it ends.
      const balanceGuard = await getBalanceGuardResponse(user.id, modelConfig.pricing, scopedDbFor(authResult));
      if (balanceGuard) {
        observation.fail('admission');
        return balanceGuard;
      }
      observation.update({ billing: 'metered' });
      const onUsage = usageBiller(user.id, 'analysis');

      const prepared = await prepareAdmittedInterpretAnalysis(
        config, request, input, user.id, promptContext, false, observation,
      );
      if (prepared instanceof Response) return prepared;
      const { prompts: { systemPrompt, userPrompt } } = prepared;

      // The use case owns completion and saving; SDK and HTTP stay in this adapter.
      const mode = isVision && buildVisionOptions ? 'vision' : stream ? 'stream' : 'text';
      const complete = createManagedAnalysisCompletion(mode, {
        // Non-stream responses report the terminal state after formatting.
        observation: mode === 'stream' ? observation : { ...observation, finish: state => observation.update(state ?? {}) },
        persist: async ({ content, reasoning }) => {
          const conversationId = await persistConversation(
            input, user.id, resolvedModelId, reasoningEnabled, content, reasoning ?? null, promptContext,
          );
          if (persistRecord) {
            await persistRecord(input, user.id, conversationId, promptContext);
          }
          return conversationId;
        },
        isPersistenceError: (error) => error instanceof AIAnalysisConversationPersistenceError,
      });

      observation.phase('generation');
      completionOwnsTerminal = mode === 'stream';
      try {
        if (mode === 'stream') {
          return await handleStreamCall(resolvedModelId, reasoningEnabled, systemPrompt, userPrompt, complete, observation, onUsage, request.signal);
        }

        const outcome = await runManagedAnalysis(async () => {
          if (mode === 'vision') {
            const visionOpts = buildVisionOptions!(input);
            const content = await callAIVision(
              [{ role: 'user', content: userPrompt }],
              resolvedModelId,
              `\n\n${systemPrompt}\n\n`,
              { reasoning: reasoningEnabled, temperature: 0.7, ...visionOpts, onUsage },
            );
            return { content, reasoning: null };
          }
          return callAIWithReasoning(
            [{ role: 'user', content: userPrompt }],
            resolvedModelId,
            `\n\n${systemPrompt}\n\n`,
            { reasoning: reasoningEnabled, temperature: 0.7, onUsage },
          );
        }, complete);
        return formatManagedOutcome(outcome, mode === 'vision');
      } catch (aiError) {
        // SDK setup failures use the completion latch.
        await complete({ kind: 'inference-failed', error: aiError });
        if (aiError instanceof AIAnalysisConversationPersistenceError) {
          return jsonError('保存结果失败，请稍后重试', 500, { success: false });
        }
        return jsonError(extractAIErrorMessage(aiError), 500, { success: false });
      }
    } catch (error) {
      observation.fail();
      throw error;
    } finally {
      if (!completionOwnsTerminal) observation.finish();
    }
  };

  /**
   * A photo reading on the member's own vision model whose key is stored here: sent from this server with the photo,
   * no balance needed, usage recorded at $0. Text routes keep to platform models.
   */
  async function handleByokAnalysis(
    request: NextRequest, body: Record<string, unknown>, ref: string, input: T, userId: string, db: ScopedDb,
    promptContext: TContext | undefined, observation: RequestObservation,
  ): Promise<Response> {
    if (!isVision || !buildVisionOptions) {
      observation.fail('admission');
      return jsonError('这里不能使用自定义模型', 400, { success: false });
    }
    const gate = await byokGate();
    if (gate) {
      observation.fail('admission');
      return gate;
    }
    let effort: AIReasoningEffort | null;
    try { effort = parseReasoningEffort(body.reasoningEffort); } catch { return jsonError('推理档位无效', 400, { success: false }); }
    const resolved = await serverByokModel(db, userId, ref);
    if ('error' in resolved) {
      observation.fail('admission');
      return jsonError(resolved.error, 400, { success: false });
    }
    if (!resolved.model.supportsVision) {
      observation.fail('admission');
      return jsonError('这个模型没有开启图片输入，请在「设置 → 自定义模型」里打开「识图」', 400, { success: false });
    }
    observation.update({ billing: 'not-applicable' });
    const prepared = await prepareAdmittedInterpretAnalysis(config, request, input, userId, promptContext, false, observation);
    if (prepared instanceof Response) return prepared;
    const { prompts: { systemPrompt, userPrompt } } = prepared;
    const reasoningEnabled = body.reasoning === true;
    const complete = createManagedAnalysisCompletion('vision', {
      observation: { ...observation, finish: state => observation.update(state ?? {}) },
      persist: async ({ content, reasoning }) => {
        const conversationId = await persistConversation(input, userId, ref, reasoningEnabled, content, reasoning ?? null, promptContext);
        if (persistRecord) await persistRecord(input, userId, conversationId, promptContext);
        return conversationId;
      },
      isPersistenceError: (error) => error instanceof AIAnalysisConversationPersistenceError,
    });
    observation.phase('generation');
    try {
      const outcome = await runManagedAnalysis(async () => {
        const photo = buildVisionOptions(input);
        const result = await runServerByok(resolved.model, {
          userId, key: resolved.key, systemPrompt, source: 'analysis', signal: request.signal,
          messages: [{ role: 'user', content: [{ type: 'image', data: photo.imageBase64, mimeType: photo.imageMimeType }, { type: 'text', text: userPrompt }] }],
          thinking: byokThinking(reasoningEnabled, effort, resolved.model.thinkingLevels, resolved.model.defaultEffort),
        });
        if (result.error) throw new ByokRequestError(byokFailureFromMessage(result.error));
        return { content: result.content, reasoning: result.reasoning || null };
      }, complete);
      return formatManagedOutcome(outcome, true);
    } catch (error) {
      await complete({ kind: 'inference-failed', error });
      if (error instanceof AIAnalysisConversationPersistenceError) return jsonError('保存结果失败，请稍后重试', 500, { success: false });
      return jsonError(extractAIErrorMessage(error), 500, { success: false });
    }
  }

  function formatManagedOutcome(outcome: ManagedAnalysisOutcome, vision: boolean): Response {
    if (outcome.status === 'saved') {
      const { content, reasoning } = outcome.output;
      const { conversationId } = outcome;
      if (vision) {
        return jsonOk({ success: true, data: { analysis: content, conversationId } });
      }
      return jsonOk(formatSuccessResponse
        ? formatSuccessResponse({ content, reasoning: reasoning ?? null, conversationId })
        : { success: true, data: { analysis: content, reasoning, conversationId } });
    }
    if (outcome.status === 'aborted' || outcome.failure === 'empty') {
      return jsonError(emptyResultMessage, 500, { success: false });
    }
    if (outcome.error instanceof AIAnalysisConversationPersistenceError) {
      return jsonError('保存结果失败，请稍后重试', 500, { success: false });
    }
    return jsonError(extractAIErrorMessage(outcome.error), 500, { success: false });
  }

  // Streaming transport reports completion only after the use case has saved.
  async function handleStreamCall(
    resolvedModelId: string, reasoningEnabled: boolean,
    systemPrompt: string, userPrompt: string, complete: CompleteManagedAnalysis,
    observation: RequestObservation, onUsage: ReturnType<typeof usageBiller>,
    signal: AbortSignal,
  ): Promise<Response> {
    const streamResult = await callAIUIMessageResult(
      [{ role: 'user', content: userPrompt }],
      `\n\n${systemPrompt}\n\n`,
      resolvedModelId,
      { abortSignal: signal, reasoning: reasoningEnabled, temperature: 0.7, onUsage },
    );
    return createPersistentStreamResponse({
      streamResult,
      onStreamAbort: () => complete({ kind: 'aborted' }),
      onStreamAdapterFailure: () => {
        observation.fail('stream-adapter');
        observation.finish({ generation: 'failed' });
      },
      onStreamComplete: async (output) => {
        const outcome = await complete({ kind: 'output', output });
        if (outcome.status !== 'failed') return {};
        if (outcome.failure === 'empty') return { error: emptyResultMessage };
        return { error: '保存结果失败，请稍后重试' };
      },
    });
  }

  // ── Shared persistence ──
  async function persistConversation(
    input: T, userId: string, resolvedModelId: string,
    reasoningEnabled: boolean, aiResponse: string, reasoningText: string | null,
    promptContext?: TContext,
  ): Promise<string> {
    const sourceData = buildSourceData(input, resolvedModelId, reasoningEnabled, promptContext);
    if (reasoningText) {
      sourceData.reasoning_text = reasoningText;
    }
    const resolvedSourceType = typeof sourceType === 'function'
      ? sourceType(input, promptContext)
      : sourceType;
    const conversationId = await createAIAnalysisConversation({
      userId,
      sourceType: resolvedSourceType as Parameters<typeof createAIAnalysisConversation>[0]['sourceType'],
      sourceData,
      title: generateTitle(input, promptContext),
      aiResponse,
      historyBinding: buildHistoryBinding
        ? buildHistoryBinding(input, userId, promptContext)
        : null,
    });

    if (typeof conversationId !== 'string' || conversationId.trim().length === 0) {
      throw new AIAnalysisConversationPersistenceError(
        resolvedSourceType as Parameters<typeof createAIAnalysisConversation>[0]['sourceType'],
        'createAIAnalysisConversation returned an invalid conversation id',
      );
    }

    return conversationId;
  }
}

export { jsonOk, jsonError };
