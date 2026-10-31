import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { isValidUUID } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  IMAGE_GENERATION_RATE_LIMIT,
  ImageGenerationError,
  generateImages,
  imagePriceMicros,
  resolveImageModel,
} from '@/lib/ai/image-generation.server';
import { GENERATED_IMAGE_MAX_COUNT, isGeneratedImageSize } from '@/lib/images/generated';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** 输入框直接生图：不经过对话模型，生成后由客户端写入当前对话。 */
export async function POST(request: NextRequest) {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

  const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
  if (featureGuardResponse) return featureGuardResponse;

  if (!(await checkRateLimit(auth.user.id, IMAGE_GENERATION_RATE_LIMIT.endpoint, IMAGE_GENERATION_RATE_LIMIT)).allowed) {
    return jsonError('请求过于频繁，请稍后再试', 429);
  }

  let body: { prompt?: unknown; size?: unknown; count?: unknown; conversationId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError('请求体无效', 400);
  }
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

  const model = await resolveImageModel();
  if (!model) return jsonError('当前没有可用的生图模型', 403);

  if (conversationId) {
    const conversation = await auth.db.tx(trx => trx.selectFrom('conversations').select('id')
      .where('id', '=', conversationId as string).where('user_id', '=', auth.user.id).executeTakeFirst());
    if (!conversation) return jsonError('对话不存在', 404);
  }

  try {
    const result = await generateImages({
      userId: auth.user.id,
      prompt,
      size,
      count: Number(count),
      model,
      conversationId: (conversationId as string | undefined) ?? null,
      abortSignal: request.signal,
    });
    return jsonOk({
      images: result.images,
      model: { id: model.id, name: model.name, priceMicros: imagePriceMicros(model) },
      costMicros: result.costMicros,
    });
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      if (error.code === 'INSUFFICIENT_BALANCE') return jsonError(error.message, 402, { code: 'INSUFFICIENT_BALANCE' });
      return jsonError(error.message, error.code === 'FAILED' ? 502 : 400);
    }
    console.error('[images/generate]', error instanceof Error ? error.message : error);
    return jsonError('生成图片失败，请稍后重试', 502);
  }
}
