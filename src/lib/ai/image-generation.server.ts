import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { generateImage, type ImageModel, type GeneratedFile } from 'ai';
import type { AIModelConfig } from '@/types';
import type { MembershipType } from '@/lib/user/membership';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { getObjectStore } from '@/lib/storage/index.server';
import type { ObjectStore } from '@/lib/storage/object-store';
import { getModelsByUsageTypeAsync } from '@/lib/server/ai-config';
import { isModelAllowedForMembership } from '@/lib/ai/ai-access';
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

export type ImageGenerationErrorCode = 'INVALID' | 'INSUFFICIENT_CREDITS' | 'FAILED';

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

export type ImageGenerationResult = {
  images: GeneratedImageDto[];
  /** Credits left after the charge and any partial refund; null when the model is free. */
  remaining: number | null;
};

/** Everything a test replaces: the scoped database, the object store and the image model call. */
export type ImageGenerationDeps = {
  db?: ScopedDb;
  store?: ObjectStore;
  createModel?: (config: AIModelConfig) => ImageModel;
  generate?: typeof generateImage;
  countRunImages?: (runId: string) => Promise<number>;
};

const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** The image model the member may use: the first enabled one with a callable source. */
export async function resolveImageModel(membership: MembershipType): Promise<AIModelConfig | null> {
  const models = await getModelsByUsageTypeAsync('image');
  return models.find(model => isModelAllowedForMembership(model, membership) && getOrderedModelSources(model).length > 0) ?? null;
}

export function imageModelCreditCost(model: AIModelConfig): number {
  const cost = Math.round(model.creditCost ?? 1);
  return Number.isFinite(cost) && cost > 0 ? Math.min(cost, 1000) : 0;
}

async function charge(db: ScopedDb, userId: string, amount: number): Promise<number | null> {
  if (amount <= 0) return null;
  let remaining: unknown;
  try {
    remaining = await db.rpc('decrement_ai_chat_count_by', { user_id: userId, amount });
  } catch (error) {
    console.error('[image-generation] credit charge failed:', error);
    throw new ImageGenerationError('积分扣除失败，请稍后重试', 'FAILED');
  }
  if (typeof remaining !== 'number') throw new ImageGenerationError('积分不足，无法生成图片', 'INSUFFICIENT_CREDITS');
  return remaining;
}

/** Best effort: a failed refund is reported, never hides the generation outcome. */
async function refund(db: ScopedDb, userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  try {
    const remaining = await db.rpc('increment_ai_chat_count', { user_id: userId, amount });
    if (typeof remaining !== 'number') console.error('[image-generation] credit refund failed', { userId, amount });
  } catch (error) {
    console.error('[image-generation] credit refund failed', { userId, amount, error });
  }
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
  request: ImageGenerationRequest,
  files: readonly GeneratedFile[],
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
      const objectPath = `${request.userId}/${id}.${extension}`;
      await store.put(GENERATED_IMAGE_BUCKET, objectPath, bytes, { contentType: mimeType });
      written.push({ id, objectPath });
      await db.tx(trx => trx.insertInto('generated_images').values({
        id,
        user_id: request.userId,
        conversation_id: request.conversationId ?? null,
        run_id: request.runId ?? null,
        message_id: request.messageId ?? null,
        model_id: request.model.id,
        prompt: request.prompt,
        size: request.size,
        object_path: objectPath,
        mime_type: mimeType,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }).execute());
      images.push({ id, size: request.size, mimeType, url: generatedImageUrl(id) });
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
 * Generate images for one user, charging `credit_cost` per delivered image.
 * Sources fail over in order; a failure before any image is delivered refunds the whole charge, and a source that
 * returns fewer images than asked refunds the difference.
 */
export async function generateImages(
  request: ImageGenerationRequest,
  deps: ImageGenerationDeps = {},
): Promise<ImageGenerationResult> {
  const prompt = request.prompt.trim();
  if (!prompt || prompt.length > GENERATED_IMAGE_PROMPT_MAX) throw new ImageGenerationError(`提示词须为 1–${GENERATED_IMAGE_PROMPT_MAX} 个字符`);
  if (!isGeneratedImageSize(request.size)) throw new ImageGenerationError('图片尺寸无效');
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > GENERATED_IMAGE_MAX_COUNT) {
    throw new ImageGenerationError(`每次可生成 1–${GENERATED_IMAGE_MAX_COUNT} 张图片`);
  }

  const db = deps.db ?? systemDb();
  const store = deps.store ?? getObjectStore();
  const generate = deps.generate ?? generateImage;
  const createModel = deps.createModel ?? createImageModelFromConfig;
  const count = request.count;

  if (request.runId) {
    const used = deps.countRunImages ? await deps.countRunImages(request.runId) : await countRunImages(db, request.runId);
    if (used + count > GENERATED_IMAGE_RUN_LIMIT) {
      throw new ImageGenerationError(`本次任务最多生成 ${GENERATED_IMAGE_RUN_LIMIT} 张图片${used ? `（已生成 ${used} 张）` : ''}`);
    }
  }

  const sources = getOrderedModelSources(request.model);
  if (!sources.length) throw new ImageGenerationError('生图模型还没有可用的网关来源', 'FAILED');

  const creditCost = imageModelCreditCost(request.model);
  const charged = creditCost * count;
  const remaining = await charge(db, request.userId, charged);
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
      const images = await storeImages(db, store, { ...request, prompt }, files);
      const undelivered = count - images.length;
      if (undelivered > 0) await refund(db, request.userId, creditCost * undelivered);
      return { images, remaining: remaining === null ? null : remaining + creditCost * undelivered };
    } catch (error) {
      lastError = error;
      if (request.abortSignal?.aborted) break;
    }
  }

  await refund(db, request.userId, charged);
  console.error('[image-generation] all sources failed', {
    model: request.model.id,
    sources: sources.map(source => source.sourceKey),
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  if (request.abortSignal?.aborted) throw new ImageGenerationError('已停止生成', 'FAILED');
  throw new ImageGenerationError('生成图片失败，请稍后重试', 'FAILED');
}

/** Loads one image the caller may read: its own row, or through an active share of its conversation. */
export async function findGeneratedImageForShare(db: ScopedDb, token: string, imageId: string) {
  const rows = await db.rpc('get_shared_generated_image', { p_token: token, p_image: imageId });
  return rows[0] ?? null;
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
