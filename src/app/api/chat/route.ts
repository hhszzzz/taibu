/**
 * AI 对话 API 路由
 *
 * 路由仅负责协议层：
 * - 请求解析与错误边界
 * - 复用 server-only chat orchestration
 * - 返回 JSON / SSE 响应
 *
 * 平台模型按实际用量计费：调用结束后按上游返回的 usage 入账，拿不到时按提示词与已产出文字估算。
 * `byok:` 模型（Key 保存在本站的自定义模型）由本站经 pi-ai 代发，用量按 $0 记入。
 */

import { createRequestObservation } from '@/lib/server/analysis';
import { NextRequest } from 'next/server';
import { isTextUIPart } from 'ai';
import {
  callAI,
  callAIUIMessageResult,
} from '@/lib/ai/ai';
import { extractAIErrorInfo } from '@/lib/ai/ai-error';
import { usageBiller } from '@/lib/billing/account.server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import {
  parseChatRequestBody,
  prepareChatRequest,
} from '@/lib/server/chat/request';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { isByokRef } from '@/lib/byok/config';
import { handleServerByokChat } from '@/lib/byok/chat.server';

export async function POST(request: NextRequest) {
  const observation = createRequestObservation(crypto.randomUUID(), 'chat', () => performance.now(), event => console.info('[ai-request]', event));
  let streaming = false;
  let generationStarted = false;
  let streamTerminal: Promise<void> | undefined;

  try {
    const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
    if (featureGuardResponse) {
      observation.fail('admission');
      return featureGuardResponse;
    }

    const body = await parseChatRequestBody(request);
    if (body instanceof Response) {
      observation.fail('admission');
      return body;
    }
    if (isByokRef(body.model)) return await handleServerByokChat(request, body, body.model);

    const preparedRequest = await prepareChatRequest(request, body, observation);
    if (preparedRequest instanceof Response) {
      observation.fail('admission');
      return preparedRequest;
    }

    const {
      body: resolvedBody,
      userId,
      metered,
      requestedModelId,
      reasoningEnabled,
      sanitizedMessages,
      metadata,
      fallbackPersonality,
      systemPrompt,
    } = preparedRequest;
    const onUsage = metered && userId
      ? usageBiller(userId, 'chat', resolvedBody.conversationId ? { type: 'conversation', id: resolvedBody.conversationId } : undefined)
      : undefined;

    observation.update({ billing: onUsage ? 'metered' : 'not-applicable' });
    observation.phase('generation');
    generationStarted = true;

    if (resolvedBody.stream) {
      const streamResult = await callAIUIMessageResult(
        sanitizedMessages,
        fallbackPersonality,
        '',
        requestedModelId,
        { abortSignal: request.signal, reasoning: reasoningEnabled, reasoningEffort: reasoningEnabled ? resolvedBody.reasoningEffort : null, systemPromptOverride: systemPrompt, conversationId: resolvedBody.conversationId, cacheScope: userId ?? undefined, onUsage }
      );

      const response = streamResult.toUIMessageStreamResponse({
        headers: {
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
        sendReasoning: true,
        sendSources: false,
        messageMetadata: ({ part }) => part.type === 'start' ? metadata : undefined,
        onFinish: async ({ responseMessage, isAborted, finishReason }) => {
          streamTerminal ??= (async () => {
            const hasVisibleText = responseMessage.parts.some(part => isTextUIPart(part) && part.text.trim().length > 0);
            const generation = isAborted ? 'aborted' : finishReason === 'error' ? 'failed' : hasVisibleText ? 'completed' : 'empty';
            observation.update({ generation });
            observation.finish();
          })();
          await streamTerminal;
        },
      });
      streaming = true;
      return response;
    }

    const content = await callAI(
      sanitizedMessages,
      fallbackPersonality,
      requestedModelId,
      '',
      { abortSignal: request.signal, reasoning: reasoningEnabled, reasoningEffort: reasoningEnabled ? resolvedBody.reasoningEffort : null, systemPromptOverride: systemPrompt, conversationId: resolvedBody.conversationId, cacheScope: userId ?? undefined, onUsage }
    );

    observation.finish({ generation: content?.trim() ? 'completed' : 'empty' });
    return jsonOk({ content, metadata });
  } catch (error) {
    observation.fail(generationStarted ? 'inference' : undefined);
    if (generationStarted) observation.update({ generation: 'failed' });

    const errorInfo = extractAIErrorInfo(error);
    return jsonError(errorInfo.message, errorInfo.status, { code: errorInfo.code });
  } finally {
    if (!streaming) observation.finish();
  }
}
