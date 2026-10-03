/**
 * AI 对话 API 路由
 *
 * 路由仅负责协议层：
 * - 请求解析与错误边界
 * - 复用 server-only chat orchestration
 * - 返回 JSON / SSE 响应
 */

import { createRequestObservation, observeRefund } from '@/lib/server/analysis';
import { NextRequest } from 'next/server';
import { isTextUIPart } from 'ai';
import {
  callAI,
  callAIUIMessageResult,
} from '@/lib/ai/ai';
import { extractAIErrorInfo } from '@/lib/ai/ai-error';
import { refundCreditsOrLog } from '@/lib/user/credits';
import { jsonError, jsonOk } from '@/lib/api-utils';
import {
  parseChatRequestBody,
  prepareChatRequest,
} from '@/lib/server/chat/request';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';

export async function POST(request: NextRequest) {
  const observation = createRequestObservation(crypto.randomUUID(), 'chat', () => performance.now(), event => console.info('[ai-request]', event));
  let streaming = false;
  let generationStarted = false;
  let streamTerminal: Promise<void> | undefined;
  let creditDeducted = false;
  let userId: string | null = null;
  let canSkipCredit = false;

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

    const preparedRequest = await prepareChatRequest(request, body, observation);
    if (preparedRequest instanceof Response) {
      observation.fail('admission');
      return preparedRequest;
    }

    ({
      creditDeducted,
      userId,
      canSkipCredit,
    } = preparedRequest);

    const {
      body: resolvedBody,
      requestedModelId,
      reasoningEnabled,
      sanitizedMessages,
      metadata,
      fallbackPersonality,
      systemPrompt,
    } = preparedRequest;

    observation.update({ billing: creditDeducted ? 'charged' : 'not-applicable' });
    observation.phase('generation');
    generationStarted = true;

    if (resolvedBody.stream) {
      const streamResult = await callAIUIMessageResult(
        sanitizedMessages,
        fallbackPersonality,
        '',
        requestedModelId,
        { reasoning: reasoningEnabled, systemPromptOverride: systemPrompt }
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
            // Keep the legacy chat policy: lack of visible stream text refunds,
            // including abort; unlike analysis streams, visible partial text stays charged.
            if (!hasVisibleText && userId && !canSkipCredit && creditDeducted) {
              if (await observeRefund(() => refundCreditsOrLog(userId!, 1, 'chat stream empty-response'), observation)) creditDeducted = false;
            }
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
      { reasoning: reasoningEnabled, systemPromptOverride: systemPrompt }
    );

    observation.finish({ generation: content?.trim() ? 'completed' : 'empty' });
    return jsonOk({ content, metadata });
  } catch (error) {
    observation.fail(generationStarted ? 'inference' : undefined);
    if (generationStarted) observation.update({ generation: 'failed' });
    if (creditDeducted && userId && !canSkipCredit) {
      await observeRefund(() => refundCreditsOrLog(userId!, 1, 'chat route failure'), observation);
    }

    const errorInfo = extractAIErrorInfo(error);
    return jsonError(errorInfo.message, errorInfo.status, { code: errorInfo.code });
  } finally {
    if (!streaming) observation.finish();
  }
}
