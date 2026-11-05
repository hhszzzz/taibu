import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, readJsonBody, requireUserContext } from '@/lib/api-utils';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { isValidUUID } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  IMAGE_GENERATION_RATE_LIMIT,
  ImageGenerationError,
  conversationOwnedBy,
  generateByokImageSet,
  generateImages,
  imagePriceMicros,
  resolveImageModel,
  type ImageGenerationResult,
} from '@/lib/ai/image-generation.server';
import { MODEL_REQUEST_USER_AGENT } from '@/lib/ai/providers/ai-sdk-provider';
import { agentSafeFetch } from '@/lib/agent/safe-fetch.server';
import { isByokRef } from '@/lib/byok/config';
import { byokGate } from '@/lib/byok/api.server';
import { serverByokModel } from '@/lib/byok/chat.server';
import { GENERATED_IMAGE_MAX_COUNT, isGeneratedImageSize } from '@/lib/images/generated';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * 输入框直接生图：不经过对话模型，生成后由客户端写入当前对话。`model` 可选平台生图模型，或 Key 保存在本站的
 * 自定义生图模型（`byok:`，由本站代发、按 $0 记用量）。
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

  const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
  if (featureGuardResponse) return featureGuardResponse;

  if (!(await checkRateLimit(auth.user.id, IMAGE_GENERATION_RATE_LIMIT.endpoint, IMAGE_GENERATION_RATE_LIMIT)).allowed) {
    return jsonError('请求过于频繁，请稍后再试', 429);
  }

  const parsed = await readJsonBody<{ prompt?: unknown; size?: unknown; count?: unknown; conversationId?: unknown; model?: unknown }>(request, 16 * 1024);
  if ('error' in parsed) return jsonError(parsed.error.message, parsed.error.status);
  const body = parsed.body;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return jsonError('请描述要生成的图片', 400);
  const size = body?.size ?? '1024x1024';
  if (!isGeneratedImageSize(size)) return jsonError('图片尺寸无效', 400);
  const count = body?.count ?? 1;
  if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > GENERATED_IMAGE_MAX_COUNT) {
    return jsonError(`每次可生成 1–${GENERATED_IMAGE_MAX_COUNT} 张图片`, 400);
  }
  const conversationId = body?.conversationId;
  if (conversationId !== undefined && (typeof conversationId !== 'string' || !isValidUUID(conversationId))) {
    return jsonError('对话 ID 无效', 400);
  }
  const requested = body?.model;
  if (requested !== undefined && requested !== null && (typeof requested !== 'string' || !requested || requested.length > 200)) {
    return jsonError('生图模型无效', 400);
  }

  let generate: () => Promise<ImageGenerationResult>;
  let model: { id: string; name: string; priceMicros: number };
  const target = {
    userId: auth.user.id, prompt, size, count: Number(count),
    conversationId: (conversationId as string | undefined) ?? null, abortSignal: request.signal,
  };
  if (isByokRef(requested)) {
    const gate = await byokGate();
    if (gate) return gate;
    const own = await serverByokModel(auth.db, auth.user.id, requested, 'image');
    if ('error' in own) return jsonError(own.error, 400, { code: 'BYOK_UNAVAILABLE' });
    model = { id: own.model.ref, name: own.model.displayName || own.model.modelId, priceMicros: 0 };
    generate = () => generateByokImageSet({ ...target, ...own }, { fetch: agentSafeFetch, userAgent: MODEL_REQUEST_USER_AGENT });
  } else {
    const platform = await resolveImageModel(typeof requested === 'string' ? requested : null);
    if (!platform) return jsonError(requested ? '这个生图模型当前不可用' : '当前没有可用的生图模型', 403);
    model = { id: platform.id, name: platform.name, priceMicros: imagePriceMicros(platform) };
    generate = () => generateImages({ ...target, model: platform });
  }

  if (conversationId && !(await conversationOwnedBy(auth.db, auth.user.id, conversationId as string))) {
    return jsonError('对话不存在', 404);
  }

  try {
    const result = await generate();
    return jsonOk({ images: result.images, model, costMicros: result.costMicros });
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      if (error.code === 'INSUFFICIENT_BALANCE') return jsonError(error.message, 402, { code: 'INSUFFICIENT_BALANCE' });
      return jsonError(error.message, error.code === 'FAILED' ? 502 : 400);
    }
    console.error('[images/generate]', error instanceof Error ? error.message : error);
    return jsonError('生成图片失败，请稍后重试', 502);
  }
}
