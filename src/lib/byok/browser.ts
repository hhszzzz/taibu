/**
 * Own-model calls this browser makes with the key kept on the device: the site prepares prompts and keeps results,
 * the provider is called directly, and the token counts are reported afterwards for the usage log ($0).
 */
'use client';

import { requestBrowserJson } from '@/lib/browser-api';
import type { GeneratedImageDto } from '@/lib/images/generated';
import { ByokRequestError, byokFailureFromMessage, type ByokThinking } from './config';
import { generateByokImages } from './images';
import { byokBrowserFetch, byokContext, byokRequestModel, collectByokStream, streamByok, type ByokChatMessage, type ByokTokenUsage } from './pi-model';
import type { OwnModel } from './client';

export type ByokUsageSource = 'chat' | 'analysis' | 'enhance';

/** What the reader is told when this device has no key for the model. */
export function missingKeyMessage(model: Pick<OwnModel, 'displayName'>): string {
  return `「${model.displayName}」需要先在本设备填写 API Key`;
}

function deviceKey(model: OwnModel): string {
  if (!model.deviceKey) throw new Error(missingKeyMessage(model));
  return model.deviceKey;
}

/** Fire and forget: the call already happened, and a lost record only leaves the log short. */
function reportUsage(model: OwnModel, usage: ByokTokenUsage | null, source: ByokUsageSource, conversationId?: string) {
  if (!usage) return;
  void fetch('/api/chat/direct/usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model.modelId, source, ...usage, ...(conversationId ? { conversationId } : {}) }),
    keepalive: true,
  }).catch(() => {});
}

/**
 * One streamed call. A failure throws ByokRequestError with the provider's status and text; a stop throws AbortError.
 */
export async function runBrowserByok(model: OwnModel, input: {
  systemPrompt: string;
  messages: readonly ByokChatMessage[];
  thinking: ByokThinking;
  source: ByokUsageSource;
  conversationId?: string;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}): Promise<{ content: string; reasoning: string }> {
  const result = await collectByokStream(streamByok(byokRequestModel(model, model.connection), byokContext(input.systemPrompt, input.messages), {
    apiKey: deviceKey(model), thinking: input.thinking, signal: input.signal, fetch: byokBrowserFetch,
  }), { onText: input.onText, onReasoning: input.onReasoning });
  reportUsage(model, result.usage, input.source, input.conversationId);
  if (result.aborted || input.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
  if (result.error) throw new ByokRequestError(byokFailureFromMessage(result.error), { browser: true });
  return { content: result.content, reasoning: result.reasoning };
}

export type GeneratedImagesPayload = { images: GeneratedImageDto[]; model: { id: string; name: string } };

/** Generates here, then hands the images to the site to keep in the conversation. */
export async function generateImagesInBrowser(model: OwnModel, request: { conversationId: string; prompt: string; size: string; count: number }) {
  const images = await generateByokImages({
    baseUrl: model.connection.baseUrl, modelId: model.modelId, apiKey: deviceKey(model),
    prompt: request.prompt, size: request.size, count: request.count, fetch: byokBrowserFetch, browser: true,
  });
  const form = new FormData();
  form.append('prompt', request.prompt);
  form.append('size', request.size);
  form.append('model', model.ref);
  form.append('conversationId', request.conversationId);
  images.forEach((image, index) => form.append('images', new Blob([image.bytes], { type: image.mediaType }), `image-${index + 1}`));
  return requestBrowserJson<GeneratedImagesPayload>('/api/images/upload', { method: 'POST', body: form });
}
