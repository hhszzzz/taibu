import 'server-only';

import type { RequestObservation } from '@/lib/server/analysis';

import type { NextRequest } from 'next/server';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { getDefaultModelConfigAsync, getModelConfigAsync } from '@/lib/server/ai-config';
import { isModelOffered, UNPRICED_MODEL_MESSAGE } from '@/lib/ai/ai-access';
import { getAuthContext, jsonError, readRequestBytes, requireUserContext } from '@/lib/api-utils';
import { balanceUnavailableResponse, insufficientBalanceResponse } from '@/lib/api/balance-guard';
import { getSpendableMicros } from '@/lib/billing/account.server';
import { isFreeTextModel } from '@/lib/billing/pricing';
import { buildChatPromptContext } from '@/lib/server/chat/prompt-context';
import { prepareDirectChat, prepareManagedChat } from '@/lib/server/chat/use-case';
import type {
  ChatActor,
  ChatPreparationInput,
  ChatPreparationFailure,
  ManagedChatOperations,
  ResolvedChatPreparation,
} from '@/lib/server/chat/contracts';
import { normalizeIdentityUserProfile } from '@/lib/user/settings';
import { AI_RATE_LIMIT_CONFIG, checkRateLimit } from '@/lib/rate-limit';
import { normalizeVisualizationSettings } from '@/lib/visualization/settings';
import { parseReasoningEffort } from '@/lib/chat/model-settings';
import { isChatAttachment } from '@/lib/ai/document-formats';

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET;
const MANAGED_CHAT_RATE_LIMIT_KEY = '/api/chat';
const BROWSER_DIRECT_CHAT_RATE_LIMIT_KEY = '/api/chat/direct/prepare';

export interface ChatRequestBody extends ChatPreparationInput {
  skipBilling?: boolean;
  internalSecret?: string;
  /** The conversation on screen; only its hash reaches the model, as the prompt cache key. */
  conversationId?: string;
}

/** Adapter DTO; credentials never enter the transport-independent use case. */
export interface ResolvedChatRequest {
  body: ChatRequestBody;
  userId: string | null;
  metered: boolean;
  requestedModelId: string;
  reasoningEnabled: boolean;
}

export type PreparedChatRequest =
  ResolvedChatRequest &
  Awaited<ReturnType<typeof buildChatPromptContext>>;

export async function parseChatRequestBody(request: NextRequest): Promise<ChatRequestBody | Response> {
  const input = await readRequestBytes(request, 8 * 1024 * 1024);
  if ('error' in input) return jsonError(input.error.message, input.error.status);
  let body: ChatRequestBody;
  try {
    body = JSON.parse(input.bytes.toString('utf8')) as ChatRequestBody;
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || body.messages.length > 4096) {
    return jsonError('无效的消息格式', 400);
  }
  for (const message of body.messages) {
    if (!message || typeof message !== 'object' || !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string') {
      return jsonError('无效的消息格式', 400);
    }
    if (Buffer.byteLength(message.content, 'utf8') > 2 * 1024 * 1024) return jsonError('单条消息不能超过 2MB', 413);
  }
  try { body.reasoningEffort = parseReasoningEffort(body.reasoningEffort); } catch { return jsonError('推理档位无效', 400); }
  if (body.attachment !== undefined && !isChatAttachment(body.attachment)) return jsonError('附件内容无效', 400);
  if (body.webSearch !== undefined && typeof body.webSearch !== 'boolean') return jsonError('联网搜索参数无效', 400);
  if (body.conversationId !== undefined && (typeof body.conversationId !== 'string' || !body.conversationId || body.conversationId.length > 128)) {
    return jsonError('无效的对话标识', 400);
  }
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
    reasoningEffort: body.reasoningEffort,
    attachment: body.attachment,
    webSearch: body.webSearch,
    timezone: body.timezone,
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
): Omit<T, 'input'> & ResolvedChatRequest {
  const { input, ...resolved } = prepared;
  return { ...resolved, body: body ?? input };
}

function preparationErrorResponse(error: ChatPreparationFailure): Response {
  switch (error.kind) {
    case 'invalid-model':
      return jsonError('无效的模型', 400);
    case 'model-unpriced':
      return jsonError(UNPRICED_MODEL_MESSAGE, 403, { code: 'MODEL_UNPRICED' });
    case 'insufficient-balance':
      return insufficientBalanceResponse();
    case 'balance-unavailable':
      return balanceUnavailableResponse();
    case 'rate-limited':
      return jsonError('请求过于频繁，请稍后再试', 429);
    case 'rate-limit-failed':
      return jsonError('请求限流检查失败，请稍后重试', 500, { code: 'RATE_LIMIT_FAILED' });
  }
}

async function bindManagedChat(request: NextRequest, body: ChatRequestBody, observation?: RequestObservation): Promise<{
  actor: ChatActor;
  operations: ManagedChatOperations;
} | Response> {
  const trusted = !!(INTERNAL_SECRET && body.skipBilling && body.internalSecret === INTERNAL_SECRET);
  let authScoped: import('@/lib/db/context.server').ScopedDb;
  let actor: ChatActor;

  if (trusted) {
    const auth = await getAuthContext(request);
    if (auth.authError) return jsonError(auth.authError.message, auth.authError.status);
    authScoped = auth.db;
    actor = { userId: auth.user?.id || null, billing: 'trusted-bypass' };
  } else {
    const auth = await requireUserContext(request);
    if ('error' in auth) {
      observation?.fail('admission');
      return jsonError(auth.error.message, auth.error.status);
    }
    authScoped = auth.db;
    actor = { userId: auth.user.id, billing: 'metered' };
  }

  const userId = actor.userId;
  const operations: ManagedChatOperations = {
    defaultModelId: DEFAULT_MODEL_ID,
    resolveModel: async (modelId) => {
      const model = modelId ? await getModelConfigAsync(modelId) : await getDefaultModelConfigAsync('chat');
      if (!model) return null;
      return { id: model.id, offered: isModelOffered(model), pricing: model.pricing, supportsReasoning: model.supportsReasoning };
    },
    admit: async (model) => {
      if (!userId) throw new Error('Chat admission requires an authenticated user');
      return isFreeTextModel(model.pricing) || await getSpendableMicros(userId, authScoped) > 0;
    },
    checkRateLimit: async () => {
      if (!userId) throw new Error('Public chat rate admission requires an authenticated user');
      return (await checkRateLimit(userId, MANAGED_CHAT_RATE_LIMIT_KEY, AI_RATE_LIMIT_CONFIG)).allowed;
    },
    buildPrompt: async (resolved) => {
      observation?.phase('prompt');
      try {
        return await buildChatPromptContext(withRequestContext(resolved, body), { webSearch: resolved.input.webSearch === true });
      } catch (error) {
        observation?.fail('prompt');
        throw error;
      }
    },
  };
  return { actor, operations };
}

export async function prepareBrowserDirectChatRequest(
  request: NextRequest,
  body: ChatRequestBody,
  observation?: RequestObservation,
): Promise<PreparedChatRequest | Response> {
  const auth = await requireUserContext(request);
  if ('error' in auth) {
    observation?.fail('admission');
    return jsonError(auth.error.message, auth.error.status);
  }
  const result = await prepareDirectChat({ userId: auth.user.id }, toPreparationInput(body), {
    defaultModelId: DEFAULT_MODEL_ID,
    checkRateLimit: async () => (await checkRateLimit(
      auth.user.id,
      BROWSER_DIRECT_CHAT_RATE_LIMIT_KEY,
      AI_RATE_LIMIT_CONFIG,
    )).allowed,
    buildPrompt: async (resolved) => {
      observation?.phase('prompt');
      try {
        return await buildChatPromptContext(withRequestContext(resolved, body), { webSearch: resolved.input.webSearch === true });
      } catch (error) {
        observation?.fail('prompt');
        throw error;
      }
    },
  });
  if (!result.ok) observation?.fail('admission');
  return result.ok
    ? withRequestContext(result.value, body)
    : preparationErrorResponse(result.error);
}

export async function prepareChatRequest(
  request: NextRequest,
  body: ChatRequestBody,
  observation?: RequestObservation,
): Promise<PreparedChatRequest | Response> {
  const adapter = await bindManagedChat(request, body, observation);
  if (adapter instanceof Response) {
    observation?.fail('admission');
    return adapter;
  }
  const result = await prepareManagedChat(adapter.actor, toPreparationInput(body), adapter.operations);
  if (!result.ok) observation?.fail('admission');
  return result.ok
    ? withRequestContext(result.value, body)
    : preparationErrorResponse(result.error);
}
