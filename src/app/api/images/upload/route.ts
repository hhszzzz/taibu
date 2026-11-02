import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, readMultipartForm, requireUserContext } from '@/lib/api-utils';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { getByokPolicy } from '@/lib/app-settings';
import { isValidUUID } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { IMAGE_GENERATION_RATE_LIMIT, ImageGenerationError, storeByokImages } from '@/lib/ai/image-generation.server';
import { byokGate } from '@/lib/byok/api.server';
import { resolveByokModel } from '@/lib/byok/store.server';
import { GENERATED_IMAGE_MAX_COUNT, isGeneratedImageSize } from '@/lib/images/generated';
import { readStillImage } from '@/lib/images/still-image';

export const runtime = 'nodejs';

/** One uploaded image may take this many bytes; a 1792×1024 PNG stays well under it. */
const UPLOAD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** 自定义生图模型（Key 只在浏览器里）：浏览器直连生成后把图片交给本站保存，写入当前对话；按 $0 记用量。 */
export async function POST(request: NextRequest) {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

  const featureGuardResponse = await getGlobalAIFeatureGuardResponse() ?? await byokGate();
  if (featureGuardResponse) return featureGuardResponse;

  if (!(await checkRateLimit(auth.user.id, IMAGE_GENERATION_RATE_LIMIT.endpoint, IMAGE_GENERATION_RATE_LIMIT)).allowed) {
    return jsonError('请求过于频繁，请稍后再试', 429);
  }

  const parsed = await readMultipartForm(request, UPLOAD_IMAGE_MAX_BYTES * GENERATED_IMAGE_MAX_COUNT);
  if ('error' in parsed) return jsonError(parsed.error.message, parsed.error.status);
  const { form } = parsed;
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const prompt = field('prompt');
  const size = field('size');
  const conversationId = field('conversationId');
  if (!isGeneratedImageSize(size)) return jsonError('图片尺寸无效', 400);
  if (conversationId && !isValidUUID(conversationId)) return jsonError('对话 ID 无效', 400);
  const model = await resolveByokModel(auth.db, auth.user.id, field('model'), await getByokPolicy());
  if (!model || model.usage !== 'image') return jsonError('自定义生图模型不存在，可能已被删除', 400);
  const uploads = form.getAll('images');
  if (!uploads.length || uploads.length > GENERATED_IMAGE_MAX_COUNT || uploads.some(upload => !(upload instanceof File))) {
    return jsonError(`每次可保存 1–${GENERATED_IMAGE_MAX_COUNT} 张图片`, 400);
  }

  const files: Array<{ uint8Array: Uint8Array; mediaType: string; size: string }> = [];
  for (const upload of uploads as File[]) {
    if (!upload.size || upload.size > UPLOAD_IMAGE_MAX_BYTES) {
      return jsonError(`每张图片须小于 ${UPLOAD_IMAGE_MAX_BYTES / 1024 / 1024}MB`, 413);
    }
    const bytes = new Uint8Array(await upload.arrayBuffer());
    const image = readStillImage(bytes);
    if (!image) return jsonError('仅支持宽高 100–9999 像素的静态 PNG、JPEG、WebP 图片', 400);
    files.push({ uint8Array: bytes, ...image });
  }

  if (conversationId) {
    const conversation = await auth.db.tx(trx => trx.selectFrom('conversations').select('id')
      .where('id', '=', conversationId).where('user_id', '=', auth.user.id).executeTakeFirst());
    if (!conversation) return jsonError('对话不存在', 404);
  }

  try {
    const images = await storeByokImages({ userId: auth.user.id, prompt, size, model, conversationId: conversationId || null }, files);
    return jsonOk({ images, model: { id: model.ref, name: model.displayName || model.modelId, priceMicros: 0 } });
  } catch (error) {
    if (error instanceof ImageGenerationError) return jsonError(error.message, 400);
    console.error('[images/upload]', error instanceof Error ? error.message : error);
    return jsonError('保存图片失败，请稍后重试', 500);
  }
}
