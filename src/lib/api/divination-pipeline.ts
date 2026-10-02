/**
 * 占卜路由工厂
 *
 * 共享准入与生成流水线：
 * 1. Auth (requireBearerUser / requireUserContext)
 * 2. Ordinary route precheck + owned-resource context validation
 * 3. Account loading and model membership admission
 * 4. Credit balance check and actual deduction
 * 5. Endpoint rate admission (refund a rejected managed debit once)
 * 6. Final prompt assembly
 * 7. AI call (stream / non-stream, text / vision)
 * 8. Persist conversation + refund on failure
 */

import { type NextRequest } from 'next/server';
import { createUIMessageStream, createUIMessageStreamResponse, type FinishReason } from 'ai';
import {
  jsonError,
  jsonOk,
  requireBearerUser,
  requireUserContext,
  resolveRequestDbClient,
  SSE_HEADERS,
} from '@/lib/api-utils';
import {
  attemptCreditUse,
  getUserAuthInfo,
  refundCreditsOrLog,
  UserStateResolutionError,
} from '@/lib/user/credits';
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
  persistDirectAnalysis,
  prepareAnalysis,
  prepareAdmittedAnalysis,
  runManagedAnalysis,
  type AnalysisAdmissionBilling,
  type CompleteManagedAnalysis,
  type ManagedAnalysisOutcome,
} from '@/lib/server/analysis';
import type { AIPersonality } from '@/types';
import type { ChartType } from '@/lib/visualization/chart-types';
import { buildVisualizationOutputContractPrompt } from '@/lib/visualization/prompt';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { AI_RATE_LIMIT_CONFIG, checkRateLimit } from '@/lib/rate-limit';

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
  db: DivinationDbClient;
  accessToken: string | null;
};

type SuccessfulDivinationAuthResult = {
  user: { id: string };
  db?: UserContextAuthResult['db'];
  supabase?: UserContextAuthResult['db'];
  accessToken?: string | null;
};

type DivinationDbClient = NonNullable<ReturnType<typeof resolveRequestDbClient>>;

type RouteError = { error: string; status: number };

type AuthMethod = 'bearer' | 'userContext';

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
  client: SaveUserOwnedRecordClient;
  tag: string;
  tableName: string;
  input: TInput;
  userId: string;
  buildInsertPayload: (input: TInput, userId: string) => Record<string, unknown>;
  errorMessage?: string;
};

type SaveUserOwnedRecordResult = {
  data?: { id?: string | null } | null;
  error?: { message?: string } | null;
};
type SaveUserOwnedRecordClient = {
  from: (tableName: string) => {
    insert: (payload: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => PromiseLike<SaveUserOwnedRecordResult>;
      };
    };
  };
};

export async function persistUserOwnedDivinationRecord<
  TInput,
>({
  client,
  tag,
  tableName,
  input,
  userId,
  buildInsertPayload,
  errorMessage = '保存记录失败',
}: PersistUserOwnedRecordOptions<TInput>): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await client
    .from(tableName)
    .insert(buildInsertPayload(input, userId))
    .select('id')
    .single();

  if (error) {
    console.error(`[${tag}] ${errorMessage}:`, error.message);
    return {
      id: null,
      error: errorMessage,
    };
  }

  return {
    id: (data as { id?: string } | null)?.id ?? null,
    error: null,
  };
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

  const client = resolveAuthDbClient(authResult);
  if (isRouteError(client)) {
    return jsonError(client.error, client.status, { success: false });
  }

  const { id, error } = await persistUserOwnedDivinationRecord({
    client: client as unknown as SaveUserOwnedRecordClient,
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
  /** Auth strategy (defaults to Bearer token). */
  authMethod?: AuthMethod;
  /** Parse & validate the request body. Return parsed input or an error. */
  parseInput: (body: unknown) => T | RouteError;
  /** Resource/business precheck before account admission; never a rate limiter. */
  precheck?: (request: NextRequest, input: T, userId: string) => Promise<RouteError | null> | RouteError | null;
  /** Overrides the default user/path 20/min limit after membership and any debit.
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
  /** AI personality for the call (defaults to 'general'). */
  personality?: AIPersonality;
  /** Whether this is a vision route (face/palm). */
  isVision?: boolean;
  /** Vision-specific options builder. Only used when isVision=true. */
  buildVisionOptions?: (input: T) => { imageBase64: string; imageMimeType: string };
  /** resolveModelAccessAsync extra options (e.g. requireVision). */
  modelAccessOptions?: {
    requireVision?: boolean;
    membershipDeniedMessage?: string;
  };
  /** 该路由允许 AI 输出的可视化图表类型。传入后会自动在 system prompt 尾部追加图表输出合约。 */
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
      return chartTypes?.length ? buildVisualizationOutputContractPrompt(chartTypes) : undefined;
    },
  });
}

async function prepareAdmittedInterpretAnalysis<T extends InterpretInput, TContext extends InterpretPromptContext>(
  config: DivinationRouteConfig<T, TContext>,
  request: NextRequest,
  input: T,
  userId: string,
  context: TContext | undefined,
  billing: AnalysisAdmissionBilling,
) {
  const rejection: { value: RouteError | null } = { value: null };
  const result = await prepareAdmittedAnalysis(billing, {
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

  if (result.error) console.error(`[${config.tag}] ${result.reason}:`, result.error);
  if (result.billing === 'refund-failed') {
    console.error(`[${config.tag}] admission refund failed`, { userId, error: result.refundError });
    return jsonError('请求未执行，积分退还失败，请联系客服', 500, {
      success: false, code: 'CREDIT_REFUND_FAILED', refundFailed: true,
    });
  }
  if (result.reason === 'limited') {
    return jsonError(rejection.value?.error ?? '请求过于频繁，请稍后再试', rejection.value?.status ?? 429, { success: false });
  }
  if (result.reason === 'rate-error') {
    return jsonError('请求限流检查失败，请稍后重试', 500, { success: false, code: 'RATE_LIMIT_FAILED' });
  }
  return jsonError(billing.kind === 'not-applicable' ? '生成直连上下文失败，请稍后重试' : '生成分析上下文失败，请稍后重试', 500, {
    success: false, code: 'PROMPT_PREPARATION_FAILED',
  });
}

export interface PersistentStreamResult {
  error?: string | null;
}

function resolveAuthDbClient(
  authResult: Partial<Pick<UserContextAuthResult, 'db' | 'supabase'>>,
): DivinationDbClient | RouteError {
  // Missing caller identity must never become an implicit privileged operation.
  return resolveRequestDbClient(authResult)
    ?? { error: '用户数据库上下文不可用，请稍后重试', status: 500 };
}

function toDivinationAuthContext(
  authResult: SuccessfulDivinationAuthResult,
): DivinationAuthContext | RouteError {
  const db = resolveAuthDbClient(authResult);
  if (isRouteError(db)) return db;
  return {
    userId: authResult.user.id,
    db,
    accessToken: authResult.accessToken ?? null,
  };
}

export function createPersistentStreamResponse({
  streamResult,
  onStreamComplete,
}: {
  streamResult: Awaited<ReturnType<typeof callAIUIMessageResult>>;
  onStreamComplete: (result: { content: string; reasoning: string | null }) => Promise<PersistentStreamResult>;
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

      const finishResult = await finishPromise;
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

function resolveDirectPersistModelId(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return 'custom-provider';
}

export function createDirectInterpretHandlers<
  T extends InterpretInput,
  TContext extends InterpretPromptContext = InterpretPromptContext,
>(
  config: DivinationRouteConfig<T, TContext>,
) {
  const {
    sourceType,
    tag,
    authMethod = 'bearer',
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
    },
  ): Promise<Response | ResolvedPreparedBase | ResolvedPreparedWithPrompts> => {
    const { runPrecheck, includePrompts } = options;
    const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
    if (featureGuardResponse) return featureGuardResponse;

    const parsed = parseInput(body);
    if (isRouteError(parsed)) {
      return jsonError(parsed.error, parsed.status, { success: false });
    }
    const input = parsed as T;

    const authResult = authMethod === 'userContext'
      ? await requireUserContext(request)
      : await requireBearerUser(request);
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

    // BYOK validates account membership without a platform model/balance gate.
    try {
      await getUserAuthInfo(authContext.userId, { client: authContext.db, user: authResult.user });
    } catch (error) {
      if (error instanceof UserStateResolutionError) {
        return jsonError(error.message, 500, { success: false, code: error.code });
      }
      throw error;
    }
    const prepared = await prepareAdmittedInterpretAnalysis(
      config, request, input, authContext.userId, promptContext, { kind: 'not-applicable' },
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
    customModelId,
  }: {
    input: T;
    userId: string;
    promptContext?: TContext;
    content: string;
    reasoningText: string | null;
    customModelId: string;
  }): Promise<string> => {
    const persistedModelId = `custom:${customModelId}`;
    const sourceData = buildSourceData(input, persistedModelId, false, promptContext);
    sourceData.custom_provider = true;
    sourceData.custom_provider_model_id = customModelId;
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
      try {
        const prepared = await resolvePrepared(request, body, {
          runPrecheck: true,
          includePrompts: true,
        });
        if (prepared instanceof Response) {
          return prepared;
        }
        if (!('systemPrompt' in prepared) || !('userPrompt' in prepared)) {
          return jsonError('生成直连上下文失败，请稍后重试', 500, { success: false });
        }

        return jsonOk({
          success: true,
          data: {
            systemPrompt: prepared.systemPrompt,
            userPrompt: prepared.userPrompt,
          },
        });
      } catch (error) {
        console.error(`[${tag}] 直连 prepare 失败:`, error);
        return jsonError('生成直连上下文失败，请稍后重试', 500, { success: false });
      }
    },

    async handleDirectPersist(
      request: NextRequest,
      body: Record<string, unknown>,
    ): Promise<Response> {
      const prepared = await resolvePrepared(request, body, {
        runPrecheck: false,
        includePrompts: false,
      });
      if (prepared instanceof Response) {
        return prepared;
      }

      const content = typeof body.content === 'string' ? body.content : '';
      const reasoningText = typeof body.reasoningText === 'string'
        ? body.reasoningText
        : typeof body.reasoning === 'string'
          ? body.reasoning
          : null;

      const outcome = await persistDirectAnalysis({ content, reasoning: reasoningText }, (output) =>
        persistPreparedResult({
          input: prepared.input,
          userId: prepared.userId,
          promptContext: prepared.promptContext,
          content: output.content,
          reasoningText: output.reasoning ?? null,
          customModelId: resolveDirectPersistModelId(body.customModelId),
        }));
      if (outcome.status === 'empty') {
        return jsonError(emptyResultMessage, 400, { success: false });
      }
      if (outcome.status === 'failed') {
        console.error(`[${tag}] 直连结果保存失败:`, outcome.error);
        return jsonError('保存结果失败，请稍后重试', 500, { success: false });
      }
      return jsonOk({ success: true, data: { conversationId: outcome.conversationId } });
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
 * 3. Loads account membership and resolves model access
 * 4. Checks balance and deducts a credit
 * 5. Applies the endpoint rate policy with debit compensation on rejection
 * 6. Builds final prompts only after admission
 * 7. Calls AI (stream or non-stream; text or vision)
 * 8. Persists the conversation and refunds on failure
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
    authMethod = 'bearer',
    parseInput,
    precheck,
    resolvePromptContext,
    buildSourceData,
    generateTitle,
    defaultModelId = DEFAULT_MODEL_ID,
    personality = 'general',
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
    const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
    if (featureGuardResponse) return featureGuardResponse;

    // Parse input first (fast fail for invalid params)
    const parsed = parseInput(body);
    if (isRouteError(parsed)) {
      return jsonError(parsed.error, parsed.status, { success: false });
    }
    const input = parsed as T;

    // 1. Auth
    const authResult = authMethod === 'userContext'
      ? await requireUserContext(request)
      : await requireBearerUser(request);
    if ('error' in authResult) {
      return jsonError(authResult.error.message, authResult.error.status, { success: false });
    }
    const { user } = authResult;
    const authContext = toDivinationAuthContext(authResult);
    if (isRouteError(authContext)) {
      return jsonError(authContext.error, authContext.status, { success: false });
    }

    const precheckResult = precheck ? await precheck(request, input, user.id) : null;
    if (precheckResult) {
      return jsonError(precheckResult.error, precheckResult.status, { success: false });
    }

    const promptContextResult = resolvePromptContext
      ? await resolvePromptContext(input, authContext)
      : undefined;
    if (isRouteError(promptContextResult)) {
      return jsonError(promptContextResult.error, promptContextResult.status, { success: false });
    }
    const promptContext = promptContextResult as TContext | undefined;

    // 2. Credits + membership
    let authInfo;
    try {
      authInfo = await getUserAuthInfo(user.id, {
        client: authContext.db,
        user,
      });
    } catch (error) {
      if (error instanceof UserStateResolutionError) {
        return jsonError(error.message, 500, { success: false, code: error.code });
      }
      throw error;
    }
    // 3. Model membership admission precedes the balance decision.
    const modelId = (body.modelId as string | undefined);
    const reasoning = (body.reasoning as boolean | undefined);
    const stream = (body.stream as boolean | undefined);
    const membershipType = authInfo.effectiveMembership;
    const access = await resolveModelAccessAsync(
      modelId, defaultModelId, membershipType, reasoning, modelAccessOptions,
    );
    if ('error' in access) {
      return jsonError(access.error, access.status, { success: false });
    }
    const { modelId: resolvedModelId, reasoningEnabled } = access;

    if (!authInfo.hasCredits) {
      return jsonError('积分不足，请通过签到、激活码或会员权益获取积分后再使用', 402, { success: false });
    }

    // 4. Deduct credit before rate admission and final prompt assembly.
    const creditUse = await attemptCreditUse(user.id, {
      client: authContext.db,
      user,
    });
    if (!creditUse.ok) {
      if (creditUse.reason === 'insufficient_credits') {
        return jsonError('积分不足，请通过签到、激活码或会员权益获取积分后再使用', 402, { success: false });
      }
      return jsonError('积分扣减失败，请稍后重试', 500, { success: false });
    }

    const prepared = await prepareAdmittedInterpretAnalysis(
      config, request, input, user.id, promptContext,
      { kind: 'charged', refund: () => refundCreditsOrLog(user.id, 1, `${tag} admission`) },
    );
    if (prepared instanceof Response) return prepared;
    const { prompts: { systemPrompt, userPrompt } } = prepared;

    // The use case owns completion/save/refund; SDK and HTTP stay in this adapter.
    const mode = isVision && buildVisionOptions ? 'vision' : stream ? 'stream' : 'text';
    const complete = createManagedAnalysisCompletion(mode, {
      persist: async ({ content, reasoning }) => {
        const conversationId = await persistConversation(
          input, user.id, resolvedModelId, reasoningEnabled, content, reasoning ?? null, promptContext,
        );
        if (persistRecord) {
          await persistRecord(input, user.id, conversationId, promptContext);
        }
        return conversationId;
      },
      refund: (reason) => refundCreditsOrLog(user.id, 1, `${tag} ${reason}`),
      isPersistenceError: (error) => error instanceof AIAnalysisConversationPersistenceError,
    });

    try {
      if (mode === 'stream') {
        return await handleStreamCall(resolvedModelId, reasoningEnabled, systemPrompt, userPrompt, complete);
      }

      const outcome = await runManagedAnalysis(async () => {
        if (mode === 'vision') {
          const visionOpts = buildVisionOptions!(input);
          const content = await callAIVision(
            [{ role: 'user', content: userPrompt }],
            personality,
            resolvedModelId,
            `\n\n${systemPrompt}\n\n`,
            { reasoning: reasoningEnabled, temperature: 0.7, ...visionOpts },
          );
          return { content, reasoning: null };
        }
        return callAIWithReasoning(
          [{ role: 'user', content: userPrompt }],
          personality,
          resolvedModelId,
          `\n\n${systemPrompt}\n\n`,
          { reasoning: reasoningEnabled, temperature: 0.7 },
        );
      }, complete);
      return formatManagedOutcome(outcome, mode === 'vision');
    } catch (aiError) {
      // Adapter failures (including SDK stream construction or response formatting)
      // retain the existing compensation boundary, outside normal completion.
      if (aiError instanceof AIAnalysisConversationPersistenceError) {
        await refundCreditsOrLog(user.id, 1, `${tag} persistence`);
        console.error(`[${tag}] 分析结果保存失败:`, aiError);
        return jsonError('保存结果失败，请稍后重试', 500, { success: false });
      }
      await refundCreditsOrLog(user.id, 1, `${tag} ai-call`);
      console.error(`[${tag}] AI 调用失败:`, aiError);
      return jsonError(extractAIErrorMessage(aiError), 500, { success: false });
    }
  };

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
      console.error(`[${tag}] 分析结果保存失败:`, outcome.error);
      return jsonError('保存结果失败，请稍后重试', 500, { success: false });
    }
    console.error(`[${tag}] AI 调用失败:`, outcome.error);
    return jsonError(extractAIErrorMessage(outcome.error), 500, { success: false });
  }

  // Streaming transport reports completion only after the use case has saved.
  async function handleStreamCall(
    resolvedModelId: string, reasoningEnabled: boolean,
    systemPrompt: string, userPrompt: string, complete: CompleteManagedAnalysis,
  ): Promise<Response> {
    const streamResult = await callAIUIMessageResult(
      [{ role: 'user', content: userPrompt }],
      personality,
      `\n\n${systemPrompt}\n\n`,
      resolvedModelId,
      { reasoning: reasoningEnabled, temperature: 0.7 },
    );
    return createPersistentStreamResponse({
      streamResult,
      onStreamComplete: async (output) => {
        const outcome = await complete({ kind: 'output', output });
        if (outcome.status !== 'failed') return {};
        if (outcome.failure === 'empty') return { error: emptyResultMessage };
        console.error(`[${tag}] 流式结果保存失败:`, outcome.error);
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
