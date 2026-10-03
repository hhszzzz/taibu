import 'server-only';

import type { NextRequest } from 'next/server';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { getDefaultModelConfigAsync, getModelConfigAsync } from '@/lib/server/ai-config';
import { isModelAllowedForMembership, isReasoningAllowedForMembership } from '@/lib/ai/ai-access';
import { getAuthContext, jsonError, requireUserContext, resolveRequestDbClient, type AuthContextResult } from '@/lib/api-utils';
import { buildChatPromptContext } from '@/lib/server/chat/prompt-context';
import { prepareDirectChat, prepareManagedChat } from '@/lib/server/chat/use-case';
import type {
  ChatActor,
  ChatPreparationInput,
  ChatPreparationFailure,
  ChatPreparationResult,
  ChatAccount,
  ManagedChatOperations,
  ResolvedChatPreparation,
} from '@/lib/server/chat/contracts';
import {
  attemptCreditUse,
  getUserAuthInfo,
  refundCreditsOrLog,
  UserStateResolutionError,
} from '@/lib/user/credits';
import type { MembershipType } from '@/lib/user/membership';
import { normalizeIdentityUserProfile } from '@/lib/user/settings';
import { AI_RATE_LIMIT_CONFIG, checkRateLimit } from '@/lib/rate-limit';
import { normalizeVisualizationSettings } from '@/lib/visualization/settings';

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET;
const MANAGED_CHAT_RATE_LIMIT_KEY = '/api/chat';
const BROWSER_DIRECT_CHAT_RATE_LIMIT_KEY = '/api/chat/direct/prepare';
const MEMBERSHIP_TYPES: MembershipType[] = ['free', 'plus', 'pro'];

type ChatAuthUser = NonNullable<AuthContextResult['user']>;

export interface ChatRequestBody extends ChatPreparationInput {
  skipCreditCheck?: boolean;
  internalSecret?: string;
}

/** Legacy adapter DTO; credentials never enter the transport-independent use case. */
export interface ResolvedChatRequest {
  body: ChatRequestBody;
  userId: string | null;
  canSkipCredit: boolean;
  accessTokenForKB: string | null;
  requestedModelId: string;
  membershipType: MembershipType;
  reasoningEnabled: boolean;
  creditDeducted: boolean;
}

export type PreparedChatRequest =
  ResolvedChatRequest &
  Awaited<ReturnType<typeof buildChatPromptContext>>;

export async function parseChatRequestBody(request: NextRequest): Promise<ChatRequestBody | Response> {
  let body: ChatRequestBody;
  try {
    body = await request.json() as ChatRequestBody;
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }
  if (!body.messages || !Array.isArray(body.messages)) {
    return jsonError('无效的消息格式', 400);
  }
  console.log(`[chat-parse] mentions=${JSON.stringify(body.mentions)} msgCount=${body.messages.length}`);
  body.userProfile = normalizeIdentityUserProfile(body.userProfile);
  body.visualizationSettings = normalizeVisualizationSettings(body.visualizationSettings);
  return body;
}

function toPreparationInput(body: ChatRequestBody): ChatPreparationInput {
  // Explicit projection excludes internal authorization and unknown request fields.
  return {
    messages: body.messages,
    stream: body.stream,
    mangpaiMode: body.mangpaiMode,
    model: body.model,
    reasoning: body.reasoning,
    difyContext: body.difyContext,
    mentions: body.mentions,
    dreamMode: body.dreamMode,
    expressionStyle: body.expressionStyle,
    customInstructions: body.customInstructions,
    userProfile: body.userProfile,
    visualizationSettings: body.visualizationSettings,
  };
}

function withRequestContext<T extends ResolvedChatPreparation>(
  prepared: T,
  body: ChatRequestBody | undefined,
  accessTokenForKB: string | null,
): Omit<T, 'input'> & ResolvedChatRequest {
  const { input, ...resolved } = prepared;
  return { ...resolved, body: body ?? input, accessTokenForKB };
}

function preparationErrorResponse(error: ChatPreparationFailure): Response {
  switch (error.kind) {
    case 'invalid-model':
      return jsonError('无效的模型', 400);
    case 'membership-denied':
      return jsonError('当前会员等级无法使用该模型', 403);
    case 'insufficient-credits':
      return jsonError('积分不足，请先通过签到、激活码或会员权益获取积分', 402, {
        code: 'INSUFFICIENT_CREDITS',
        needRecharge: true,
      });
    case 'deduction-failed':
      return jsonError('积分扣减失败，请重试', 500, { code: 'CREDIT_DEDUCTION_FAILED' });
    case 'rate-limited':
      return jsonError('请求过于频繁，请稍后再试', 429);
    case 'rate-limit-failed':
      return jsonError('请求限流检查失败，请稍后重试', 500, { code: 'RATE_LIMIT_FAILED' });
    case 'rate-limit-refund-failed':
      return jsonError('请求未执行，积分退还失败，请联系客服', 500, {
        code: 'CREDIT_REFUND_FAILED',
        refundFailed: true,
      });
    case 'account-unavailable':
      return jsonError(error.message, 500, { code: error.code });
  }
}

function bindAccountLoader(
  userId: string | null,
  authUser: ChatAuthUser | null,
  authDb: ReturnType<typeof resolveRequestDbClient>,
): () => Promise<ChatPreparationResult<ChatAccount>> {
  return async () => {
    if (!userId) {
      return { ok: true, value: { effectiveMembership: 'free', hasCredits: false } };
    }
    try {
      const account = await getUserAuthInfo(userId, {
        client: authDb ?? undefined,
        user: authUser ?? undefined,
      });
      return { ok: true, value: { effectiveMembership: account.effectiveMembership, hasCredits: account.hasCredits } };
    } catch (error) {
      if (error instanceof UserStateResolutionError) {
        return { ok: false, error: { kind: 'account-unavailable', message: error.message, code: error.code } };
      }
      throw error;
    }
  };
}

async function bindManagedChat(request: NextRequest, body: ChatRequestBody): Promise<{
  actor: ChatActor;
  accessTokenForKB: string | null;
  operations: ManagedChatOperations;
} | Response> {
  const canSkipCredit = !!(INTERNAL_SECRET && body.skipCreditCheck && body.internalSecret === INTERNAL_SECRET);
  let accessTokenForKB: string | null;
  let authUser: ChatAuthUser | null;
  let authDb: ReturnType<typeof resolveRequestDbClient>;
  let actor: ChatActor;

  if (canSkipCredit) {
    const auth = await getAuthContext(request);
    if (auth.authError) return jsonError(auth.authError.message, auth.authError.status);
    authUser = auth.user;
    authDb = resolveRequestDbClient(auth);
    actor = { userId: auth.user?.id || null, creditPolicy: 'trusted-bypass' };
    accessTokenForKB = auth.accessToken ?? null;
  } else {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    authUser = auth.user;
    authDb = resolveRequestDbClient(auth);
    actor = { userId: auth.user.id, creditPolicy: 'charge' };
    // Auth may refresh the session; incoming request cookies still contain the old token.
    accessTokenForKB = auth.accessToken ?? null;
  }

  const userId = actor.userId;
  const operations: ManagedChatOperations = {
    defaultModelId: DEFAULT_MODEL_ID,
    resolveModel: async (modelId) => {
      const model = modelId ? await getModelConfigAsync(modelId) : await getDefaultModelConfigAsync('chat');
      if (!model) return null;
      return {
        id: model.id,
        allowedMemberships: MEMBERSHIP_TYPES.filter((membership) => isModelAllowedForMembership(model, membership)),
        reasoningMemberships: MEMBERSHIP_TYPES.filter((membership) => isReasoningAllowedForMembership(model, membership)),
      };
    },
    loadAccount: bindAccountLoader(userId, authUser, authDb),
    deductCredit: async () => {
      if (!userId) throw new Error('Chat credit deduction requires an authenticated user');
      return attemptCreditUse(userId, { client: authDb ?? undefined, user: authUser ?? undefined });
    },
    checkRateLimit: async () => {
      if (!userId) throw new Error('Public chat rate admission requires an authenticated user');
      try {
        return (await checkRateLimit(userId, MANAGED_CHAT_RATE_LIMIT_KEY, AI_RATE_LIMIT_CONFIG)).allowed;
      } catch (error) {
        console.error('[chat] Rate admission failed:', error);
        throw error;
      }
    },
    refundRateLimitFailure: async () => {
      if (!userId) return false;
      try {
        return await refundCreditsOrLog(userId, 1, 'chat rate-limit admission');
      } catch (error) {
        console.error('[chat] Rate admission refund failed:', error);
        throw error;
      }
    },
    buildPrompt: (resolved) => buildChatPromptContext(withRequestContext(resolved, body, accessTokenForKB)),
    refundPromptFailure: async () => {
      if (userId) await refundCreditsOrLog(userId, 1, 'chat prompt-context');
    },
  };
  return { actor, accessTokenForKB, operations };
}

export async function prepareBrowserDirectChatRequest(
  request: NextRequest,
  body: ChatRequestBody,
): Promise<PreparedChatRequest | Response> {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  const accessTokenForKB = auth.accessToken ?? null;
  const result = await prepareDirectChat({ userId: auth.user.id }, toPreparationInput(body), {
    defaultModelId: DEFAULT_MODEL_ID,
    checkRateLimit: async () => (await checkRateLimit(
      auth.user.id,
      BROWSER_DIRECT_CHAT_RATE_LIMIT_KEY,
      AI_RATE_LIMIT_CONFIG,
    )).allowed,
    loadAccount: () => bindAccountLoader(auth.user.id, auth.user, resolveRequestDbClient(auth))(),
    buildPrompt: (resolved) => buildChatPromptContext(withRequestContext(resolved, body, accessTokenForKB)),
  });
  return result.ok
    ? withRequestContext(result.value, body, accessTokenForKB)
    : preparationErrorResponse(result.error);
}

export async function prepareChatRequest(
  request: NextRequest,
  body: ChatRequestBody,
): Promise<PreparedChatRequest | Response> {
  const adapter = await bindManagedChat(request, body);
  if (adapter instanceof Response) return adapter;
  const result = await prepareManagedChat(adapter.actor, toPreparationInput(body), adapter.operations);
  return result.ok
    ? withRequestContext(result.value, body, adapter.accessTokenForKB)
    : preparationErrorResponse(result.error);
}
