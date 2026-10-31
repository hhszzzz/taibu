import sharp from 'sharp';
import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, readMultipartForm, requireUserContext } from '@/lib/api-utils';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { isValidUUID } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { CUSTOM_PROVIDER_MAX_MODEL_ID_LENGTH } from '@/lib/ai/custom-provider-url';
import { IMAGE_GENERATION_RATE_LIMIT, ImageGenerationError, storeCustomImages } from '@/lib/ai/image-generation.server';
import { GENERATED_IMAGE_MAX_COUNT, isGeneratedImageSize } from '@/lib/images/generated';

export const runtime = 'nodejs';

/** One uploaded image may take this many bytes; a 1792×1024 PNG stays well under it. */
const UPLOAD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_FORMATS: Readonly<Record<string, string>> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
/** Stored sizes are `{width}x{height}` with 3–4 digit sides, as the table allows. */
const STORED_SIZE = /^[1-9][0-9]{2,3}x[1-9][0-9]{2,3}$/u;

/** The image's real type and size by its bytes: one still PNG, JPEG or WebP, or null. */
async function sniffImage(bytes: Buffer): Promise<{ mediaType: string; size: string } | null> {
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata();
    const mediaType = UPLOAD_FORMATS[metadata.format ?? ''];
    if (!mediaType || !metadata.width || !metadata.height || (metadata.pages && metadata.pages > 1)) return null;
    return { mediaType, size: `${metadata.width}x${metadata.height}` };
  } catch {
    return null;
  }
}

/** 自定义生图模型：浏览器直连生成后把图片交给本站保存，写入当前对话；不计费。 */
export async function POST(request: NextRequest) {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

  const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
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
  const modelId = field('modelId');
  const conversationId = field('conversationId');
  if (!isGeneratedImageSize(size)) return jsonError('图片尺寸无效', 400);
  if (!modelId || modelId.length > CUSTOM_PROVIDER_MAX_MODEL_ID_LENGTH) return jsonError('生图模型无效', 400);
  if (conversationId && !isValidUUID(conversationId)) return jsonError('对话 ID 无效', 400);
  const uploads = form.getAll('images');
  if (!uploads.length || uploads.length > GENERATED_IMAGE_MAX_COUNT || uploads.some(upload => !(upload instanceof File))) {
    return jsonError(`每次可保存 1–${GENERATED_IMAGE_MAX_COUNT} 张图片`, 400);
  }

  const files: Array<{ uint8Array: Uint8Array; mediaType: string; size: string }> = [];
  for (const upload of uploads as File[]) {
    if (!upload.size || upload.size > UPLOAD_IMAGE_MAX_BYTES) {
      return jsonError(`每张图片须小于 ${UPLOAD_IMAGE_MAX_BYTES / 1024 / 1024}MB`, 413);
    }
    const bytes = Buffer.from(await upload.arrayBuffer());
    const image = await sniffImage(bytes);
    if (!image) return jsonError('仅支持静态 PNG、JPEG、WebP 图片', 400);
    if (!STORED_SIZE.test(image.size)) return jsonError('图片宽高须在 100–9999 像素之间', 400);
    files.push({ uint8Array: new Uint8Array(bytes), ...image });
  }

  if (conversationId) {
    const conversation = await auth.db.tx(trx => trx.selectFrom('conversations').select('id')
      .where('id', '=', conversationId).where('user_id', '=', auth.user.id).executeTakeFirst());
    if (!conversation) return jsonError('对话不存在', 404);
  }

  try {
    const images = await storeCustomImages({ userId: auth.user.id, prompt, size, customModelId: modelId, conversationId: conversationId || null }, files);
    return jsonOk({ images, model: { id: `custom:${modelId}`, name: modelId } });
  } catch (error) {
    if (error instanceof ImageGenerationError) return jsonError(error.message, 400);
    console.error('[images/upload]', error instanceof Error ? error.message : error);
    return jsonError('保存图片失败，请稍后重试', 500);
  }
}
