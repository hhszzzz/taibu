import { createRequestObservation } from '@/lib/server/analysis';
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import {
  parseChatRequestBody,
  prepareBrowserDirectChatRequest,
} from '@/lib/server/chat/request';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { byokGate } from '@/lib/byok/api.server';

export async function POST(request: NextRequest) {
  const observation = createRequestObservation(crypto.randomUUID(), 'chat:direct-prepare', () => performance.now(), event => console.info('[ai-request]', event));
  try {
    // Only own models with the key on the device prepare here; the browser then calls the provider.
    const featureGuardResponse = await getGlobalAIFeatureGuardResponse() ?? await byokGate();
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
      requestedModelId: prepared.requestedModelId,
    });
  } catch {
    observation.fail();
    return jsonError('生成直连上下文失败，请稍后重试', 500);
  } finally {
    observation.finish();
  }
}
