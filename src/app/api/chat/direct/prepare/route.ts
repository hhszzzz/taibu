import { createRequestObservation } from '@/lib/server/analysis';
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import {
  parseChatRequestBody,
  prepareBrowserDirectChatRequest,
} from '@/lib/server/chat/request';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';

export async function POST(request: NextRequest) {
  const observation = createRequestObservation(crypto.randomUUID(), 'chat:direct-prepare', () => performance.now(), event => console.info('[ai-request]', event));
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

    const prepared = await prepareBrowserDirectChatRequest(request, body, observation);
    if (prepared instanceof Response) {
      observation.fail('admission');
      return prepared;
    }

    return jsonOk({
      systemPrompt: prepared.systemPrompt,
      sanitizedMessages: prepared.sanitizedMessages,
      metadata: prepared.metadata,
      fallbackPersonality: prepared.fallbackPersonality,
      requestedModelId: prepared.requestedModelId,
    });
  } catch {
    observation.fail();
    return jsonError('生成直连上下文失败，请稍后重试', 500);
  } finally {
    observation.finish();
  }
}
