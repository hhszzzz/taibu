import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { generateImage, type ImageModel, type GeneratedFile } from 'ai';
import type { AIModelConfig } from '@/types';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { getObjectStore } from '@/lib/storage/index.server';
import type { ObjectStore } from '@/lib/storage/object-store';
import { getModelsByUsageTypeAsync } from '@/lib/server/ai-config';
import { isModelOffered } from '@/lib/ai/ai-access';
import { InsufficientBalanceError, prepayImages, recordFreeImages, refundImages } from '@/lib/billing/account.server';
import { imageCostMicros } from '@/lib/billing/pricing';
import { applySourceToModel, getOrderedModelSources } from '@/lib/ai/source-runtime';
import { createImageModelFromConfig } from '@/lib/ai/providers/ai-sdk-provider';
import {
  GENERATED_IMAGE_MAX_COUNT,
  generatedImageUrl,
  isGeneratedImageSize,
  type GeneratedImageDto,
  type GeneratedImageSize,
} from '@/lib/images/generated';

/**
 * v1 is text-to-image only. The AI SDK can send reference images (`/images/edits`), but whether the NewAPI/Octopus
 * gateways expose editing is unverified, so no reference-image mode is offered yet.
 */
/** Object-storage bucket for generated images; bytes stay behind /api/images/[id]. */
export const GENERATED_IMAGE_BUCKET = 'generated-images';
export const GENERATED_IMAGE_PROMPT_MAX = 2000;
/** One Agent run may spend at most this many images. */
export const GENERATED_IMAGE_RUN_LIMIT = 4;
/** The whole request is bounded: image models are slow and expensive. */
export const IMAGE_GENERATION_RATE_LIMIT = { endpoint: 'image-generation', maxRequests: 6, windowMs: 60_000 } as const;

export type ImageGenerationErrorCode = 'INVALID' | 'INSUFFICIENT_BALANCE' | 'FAILED';

export class ImageGenerationError extends Error {
  constructor(message: string, readonly code: ImageGenerationErrorCode = 'INVALID') {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

export type ImageGenerationRequest = {
  userId: string;
  prompt: string;
  size: GeneratedImageSize;
  count: number;
  model: AIModelConfig;
  conversationId?: string | null;
  runId?: string | null;
  messageId?: string | null;
  abortSignal?: AbortSignal;
};

/** What a stored image row records besides its bytes. */
type StoredImageTarget = Pick<ImageGenerationRequest, 'userId' | 'prompt' | 'size' | 'conversationId' | 'runId' | 'messageId'> & {
  modelId: string;
};

/** A member's own image model; the key comes from the browser or the task's sealed credential, never from storage. */
export type CustomImageProvider = { apiUrl: string; apiKey: string; modelId: string };

export type ImageGenerationResult = {
  images: GeneratedImageDto[];
  /** What the delivered images cost, in micro-dollars. */
  costMicros: number;
};

/** Everything a test replaces: the scoped database, the object store, the image model call and the billing. */
export type ImageGenerationDeps = {
  db?: ScopedDb;
  store?: ObjectStore;
  createModel?: (config: AIModelConfig) => ImageModel;
  generate?: typeof generateImage;
  countRunImages?: (runId: string) => Promise<number>;
  prepay?: typeof prepayImages;
  refund?: typeof refundImages;
  recordFree?: typeof recordFreeImages;
};

const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** The platform's image model: the first enabled, priced one with a callable source. */
export async function resolveImageModel(): Promise<AIModelConfig | null> {
  const models = await getModelsByUsageTypeAsync('image');
  return models.find(model => isModelOffered(model) && getOrderedModelSources(model).length > 0) ?? null;
}

/** Micro-dollars per generated image. */
export function imagePriceMicros(model: AIModelConfig): number {
  return imageCostMicros(model.pricing, 1);
}

async function countRunImages(db: ScopedDb, runId: string): Promise<number> {
  const row = await db.tx(trx => trx.selectFrom('generated_images')
    .select(expression => expression.fn.countAll<string>().as('count'))
    .where('run_id', '=', runId)
    .executeTakeFirst());
  return Number(row?.count ?? 0);
}

async function storeImages(
  db: ScopedDb,
  store: ObjectStore,
  request: StoredImageTarget,
  files: ReadonlyArray<Pick<GeneratedFile, 'uint8Array' | 'mediaType'> & { size?: string }>,
): Promise<GeneratedImageDto[]> {
  const written: Array<{ id: string; objectPath: string }> = [];
  const images: GeneratedImageDto[] = [];
  try {
    for (const file of files) {
      const bytes = file.uint8Array;
      const mimeType = file.mediaType;
      const extension = EXTENSION[mimeType];
      if (!extension) throw new Error(`unsupported image type ${mimeType}`);
      const id = randomUUID();
      const size = file.size ?? request.size;
      const objectPath = `${request.userId}/${id}.${extension}`;
      await store.put(GENERATED_IMAGE_BUCKET, objectPath, bytes, { contentType: mimeType });
      written.push({ id, objectPath });
      await db.tx(trx => trx.insertInto('generated_images').values({
        id,
        user_id: request.userId,
        conversation_id: request.conversationId ?? null,
        run_id: request.runId ?? null,
        message_id: request.messageId ?? null,
        model_id: request.modelId,
        prompt: request.prompt,
        size,
        object_path: objectPath,
        mime_type: mimeType,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }).execute());
      images.push({ id, size, mimeType, url: generatedImageUrl(id) });
    }
    return images;
  } catch (error) {
    for (const { id, objectPath } of written) {
      await store.delete(GENERATED_IMAGE_BUCKET, [objectPath]).catch(() => undefined);
      await db.tx(trx => trx.deleteFrom('generated_images').where('id', '=', id).execute()).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Generate images for one user, paid in full before generating at the model's price per image (never on credit).
 * Sources fail over in order; a failure before any image is delivered refunds the whole charge, and a source that
 * returns fewer images than asked refunds the difference.
 */
/** The trimmed prompt once the prompt, size and count are within bounds. */
function checkImageRequest(request: Pick<ImageGenerationRequest, 'prompt' | 'size' | 'count'>): string {
  const prompt = request.prompt.trim();
  if (!prompt || prompt.length > GENERATED_IMAGE_PROMPT_MAX) throw new ImageGenerationError(`提示词须为 1–${GENERATED_IMAGE_PROMPT_MAX} 个字符`);
  if (!isGeneratedImageSize(request.size)) throw new ImageGenerationError('图片尺寸无效');
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > GENERATED_IMAGE_MAX_COUNT) {
    throw new ImageGenerationError(`每次可生成 1–${GENERATED_IMAGE_MAX_COUNT} 张图片`);
  }
  return prompt;
}

async function checkRunImageLimit(db: ScopedDb, request: Pick<ImageGenerationRequest, 'runId' | 'count'>, count?: ImageGenerationDeps['countRunImages']) {
  if (!request.runId) return;
  const used = count ? await count(request.runId) : await countRunImages(db, request.runId);
  if (used + request.count > GENERATED_IMAGE_RUN_LIMIT) {
    throw new ImageGenerationError(`本次任务最多生成 ${GENERATED_IMAGE_RUN_LIMIT} 张图片${used ? `（已生成 ${used} 张）` : ''}`);
  }
}

export async function generateImages(
  request: ImageGenerationRequest,
  deps: ImageGenerationDeps = {},
): Promise<ImageGenerationResult> {
  const prompt = checkImageRequest(request);
  const db = deps.db ?? systemDb();
  const store = deps.store ?? getObjectStore();
  const generate = deps.generate ?? generateImage;
  const createModel = deps.createModel ?? createImageModelFromConfig;
  const count = request.count;
  await checkRunImageLimit(db, request, deps.countRunImages);

  const sources = getOrderedModelSources(request.model);
  if (!sources.length) throw new ImageGenerationError('生图模型还没有可用的网关来源', 'FAILED');

  const refund = deps.refund ?? refundImages;
  const reference = request.runId ? { referenceType: 'agent_run', referenceId: request.runId }
    : request.conversationId ? { referenceType: 'conversation', referenceId: request.conversationId } : {};
  let prepayment: Awaited<ReturnType<typeof prepayImages>>;
  try {
    prepayment = await (deps.prepay ?? prepayImages)({ userId: request.userId, model: request.model, images: count, ...reference });
  } catch (error) {
    if (error instanceof InsufficientBalanceError) throw new ImageGenerationError('余额不足，无法生成图片', 'INSUFFICIENT_BALANCE');
    console.error('[image-generation] prepayment failed', { model: request.model.id });
    throw new ImageGenerationError('扣费失败，请稍后重试', 'FAILED');
  }
  const perImage = prepayment ? prepayment.micros / count : 0;
  let lastError: unknown = null;

  for (const source of sources) {
    try {
      const applied = applySourceToModel(request.model, source);
      const result = await generate({
        model: createModel(applied),
        prompt,
        n: count,
        size: request.size,
        maxRetries: 0,
        abortSignal: request.abortSignal,
      });
      const files = result.images.slice(0, count);
      if (!files.length) throw new Error('the image model returned no images');
      const images = await storeImages(db, store, { ...request, prompt, modelId: request.model.id }, files);
      const undelivered = count - images.length;
      if (undelivered > 0 && prepayment) await refund(prepayment, undelivered);
      if (!prepayment) await (deps.recordFree ?? recordFreeImages)({ userId: request.userId, model: request.model, images: images.length, ...reference });
      return { images, costMicros: perImage * images.length };
    } catch (error) {
      lastError = error;
      if (request.abortSignal?.aborted) break;
    }
  }

  if (prepayment) await refund(prepayment, count);
  console.error('[image-generation] all sources failed', {
    model: request.model.id,
    sources: sources.map(source => source.sourceKey),
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  if (request.abortSignal?.aborted) throw new ImageGenerationError('已停止生成', 'FAILED');
  throw new ImageGenerationError('生成图片失败，请稍后重试', 'FAILED');
}

/**
 * Generate on a member's own image model with the key their Agent task holds: the platform's limits and storage, the
 * row recorded under `custom:<model>`, never billed. The caller supplies the fetch, so a task's provider address goes
 * through the same public-address checks as its chat model.
 */
export async function generateCustomImages(
  request: Omit<ImageGenerationRequest, 'model'> & { provider: CustomImageProvider },
  deps: Pick<ImageGenerationDeps, 'db' | 'store' | 'generate' | 'countRunImages'> & { fetch: typeof globalThis.fetch },
): Promise<ImageGenerationResult> {
  const prompt = checkImageRequest(request);
  const db = deps.db ?? systemDb();
  await checkRunImageLimit(db, request, deps.countRunImages);
  const { provider } = request;
  const model = createImageModelFromConfig(
    { id: `custom:${provider.modelId}`, name: provider.modelId, vendor: 'other', modelId: provider.modelId, apiUrl: provider.apiUrl, supportsReasoning: false },
    { apiKey: provider.apiKey, fetch: deps.fetch },
  );
  let files: GeneratedFile[];
  try {
    const result = await (deps.generate ?? generateImage)({
      model, prompt, n: request.count, size: request.size, maxRetries: 0, abortSignal: request.abortSignal,
    });
    files = result.images.slice(0, request.count);
  } catch (error) {
    if (request.abortSignal?.aborted) throw new ImageGenerationError('已停止生成', 'FAILED');
    console.warn('[image-generation] custom image model failed', { error: error instanceof Error ? error.name : typeof error });
    throw new ImageGenerationError('自定义生图模型请求失败，请检查生图模型与 Key', 'FAILED');
  }
  if (!files.length) throw new ImageGenerationError('自定义生图模型没有返回图片', 'FAILED');
  const images = await storeImages(db, deps.store ?? getObjectStore(), { ...request, prompt, modelId: `custom:${provider.modelId}` }, files);
  return { images, costMicros: 0 };
}

/**
 * Saves images the browser got from the member's own image model; the route has checked each is one still PNG, JPEG
 * or WebP by its bytes and read its real size (a model may not honour the size asked). Stored like platform images
 * under `custom:<model>`, never billed.
 */
export async function storeCustomImages(
  target: Omit<StoredImageTarget, 'modelId'> & { customModelId: string },
  files: ReadonlyArray<{ uint8Array: Uint8Array; mediaType: string; size: string }>,
  deps: { db?: ScopedDb; store?: ObjectStore } = {},
): Promise<GeneratedImageDto[]> {
  const prompt = checkImageRequest({ prompt: target.prompt, size: target.size, count: files.length });
  return storeImages(deps.db ?? systemDb(), deps.store ?? getObjectStore(), { ...target, prompt, modelId: `custom:${target.customModelId}` }, files);
}

/** Loads one image the caller may read: its own row, or through an active share of its conversation. */
export async function findGeneratedImageForShare(db: ScopedDb, token: string, imageId: string) {
  const rows = await db.rpc('get_shared_generated_image', { p_token: token, p_image: imageId });
  return rows[0] ?? null;
}

/** An object this old whose row is gone is a leftover; younger ones may still be mid-insert. */
const GENERATED_IMAGE_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
/** One sweep stops after this many objects; the next run continues where it stopped. */
const GENERATED_IMAGE_CLEANUP_LIMIT = 200;
const CLEANUP_BATCH = 100;

/**
 * Deletes image objects no row points at. Deleting a conversation cascades its `generated_images` rows away, and an
 * insert that fails between the upload and the row leaves bytes behind, so the bucket is compared against the table.
 * Attachments keep the same guarantee through `claim_agent_attachment_cleanup`; images have no owner-side delete, so
 * the comparison is what bounds the bucket. Objects younger than a day are left alone: their row may still be coming.
 */
export async function cleanupGeneratedImages(
  options: { limit?: number; db?: ScopedDb; store?: ObjectStore } = {},
): Promise<number> {
  const db = options.db ?? systemDb();
  const store = options.store ?? getObjectStore();
  const objects = await store.list(GENERATED_IMAGE_BUCKET, { olderThan: new Date(Date.now() - GENERATED_IMAGE_ORPHAN_AGE_MS) });
  const paths = objects.slice(0, options.limit ?? GENERATED_IMAGE_CLEANUP_LIMIT).map(object => object.key);
  if (!paths.length) return 0;
  const known = new Set<string>();
  for (let index = 0; index < paths.length; index += CLEANUP_BATCH) {
    const rows = await db.tx(trx => trx.selectFrom('generated_images').select('object_path')
      .where('object_path', 'in', paths.slice(index, index + CLEANUP_BATCH)).execute());
    for (const row of rows) known.add(row.object_path);
  }
  const orphans = paths.filter(path => !known.has(path));
  if (!orphans.length) return 0;
  await store.delete(GENERATED_IMAGE_BUCKET, orphans);
  console.info('[image-generation] removed generated images without a row', { removed: orphans.length });
  return orphans.length;
}

export type GeneratedImageLocation = { object_path: string; mime_type: string; bytes: number; sha256: string };

/** Re-reads an image and checks it against the row's size and digest before serving it. */
export async function generatedImageBytes(location: GeneratedImageLocation): Promise<Uint8Array> {
  const stored = await getObjectStore().get(GENERATED_IMAGE_BUCKET, location.object_path);
  if (!stored) throw new ImageGenerationError('图片不存在', 'FAILED');
  const bytes = new Uint8Array(await new Response(stored.stream).arrayBuffer());
  if (bytes.length !== location.bytes || createHash('sha256').update(bytes).digest('hex') !== location.sha256) {
    throw new ImageGenerationError('图片完整性校验失败', 'FAILED');
  }
  return bytes;
}
