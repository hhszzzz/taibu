import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { MockImageModelV3 } from 'ai/test';
import type { ImageModel } from 'ai';
import type { AIModelConfig, AIModelPricing } from '../types';
import type { ScopedDb } from '../lib/db/context.server';
import type { ObjectStore } from '../lib/storage/object-store';
import { InsufficientBalanceError } from '../lib/billing/account.server';
import {
  GENERATED_IMAGE_BUCKET,
  ImageGenerationError,
  cleanupGeneratedImages,
  generateImages,
  type ImageGenerationDeps,
} from '../lib/ai/image-generation.server';

const sealed = { version: 1 as const, iv: 'aXY=', tag: 'dGFn', data: 'c2VhbGVk' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const PRICED: AIModelPricing = { input: null, output: null, cacheRead: null, cacheWrite: null, image: 0.02 };

function imageModel(count: number | ((call: number, n: number) => number), maxImagesPerCall = 2) {
  let calls = 0;
  return new MockImageModelV3({
    maxImagesPerCall,
    doGenerate: async options => {
      const made = typeof count === 'function' ? count(calls, options.n) : count;
      calls += 1;
      return {
        images: Array.from({ length: made }, () => PNG.toString('base64')),
        warnings: [],
        response: { timestamp: new Date(), modelId: 'image-fixture', headers: undefined },
        providerMetadata: {},
      };
    },
  }) as unknown as ImageModel;
}

function imageConfig(sources = 1, overrides: Partial<AIModelConfig> = {}): AIModelConfig {
  return {
    id: 'image-fixture', name: '生图夹具', vendor: 'openai', modelId: 'gpt-image-1', apiUrl: 'https://gateway.example/v1',
    supportsReasoning: false, pricing: PRICED,
    sources: Array.from({ length: sources }, (_, index) => ({
      sourceKey: `gw-${index}`, sourceName: `gw-${index}`, gatewayId: `gateway-${index}`,
      apiUrl: 'https://gateway.example/v1', apiKeySecret: sealed, isEnabled: true,
    })),
    ...overrides,
  };
}

function fakeDb(options: { runImages?: number } = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const deletes: unknown[] = [];
  const table = (name: string) => {
    if (name !== 'generated_images') throw new Error(`unexpected table ${name}`);
    const query: Record<string, unknown> = {};
    Object.assign(query, {
      select: (callback: (expression: unknown) => unknown) => {
        callback({ fn: { countAll: () => ({ as: () => 'count' }) } });
        return query;
      },
      where: () => query,
      executeTakeFirst: async () => ({ count: String(options.runImages ?? 0) }),
      values: (value: Record<string, unknown>) => { inserts.push(value); return { execute: async () => undefined }; },
      execute: async () => undefined,
    });
    return query;
  };
  const db = {
    tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: table, insertInto: table, deleteFrom: (name: string) => {
      if (name !== 'generated_images') throw new Error(`unexpected table ${name}`);
      return { where: (_field: string, _operator: string, value: unknown) => { deletes.push(value); return { execute: async () => undefined }; } };
    } }),
  } as unknown as ScopedDb;
  return { db, inserts, deletes };
}

function memoryStore() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const store = {
    async put(bucket: string, key: string, body: Uint8Array, options?: { contentType?: string }) {
      objects.set(`${bucket}/${key}`, { bytes: new Uint8Array(body), contentType: options?.contentType });
    },
    async get(bucket: string, key: string) {
      const object = objects.get(`${bucket}/${key}`);
      if (!object) return null;
      return {
        stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(object.bytes); controller.close(); } }),
        size: object.bytes.length,
        mtime: new Date(),
      };
    },
    async delete(bucket: string, keys: readonly string[]) { for (const key of keys) objects.delete(`${bucket}/${key}`); },
    async list() { return []; },
  } as ObjectStore;
  return { store, objects };
}

type BillingDouble = {
  prepay: NonNullable<ImageGenerationDeps['prepay']>;
  refund: NonNullable<ImageGenerationDeps['refund']>;
  recordFree: NonNullable<ImageGenerationDeps['recordFree']>;
  prepays: unknown[];
  refunds: unknown[];
  freeRecords: unknown[];
};

function billing(options: { prepay?: 'insufficient' | 'failed' | null } = {}): BillingDouble {
  const prepays: unknown[] = [];
  const refunds: unknown[] = [];
  const freeRecords: unknown[] = [];
  return {
    prepay: async input => {
      prepays.push(input);
      if (options.prepay === 'insufficient') throw new InsufficientBalanceError();
      if (options.prepay === 'failed') throw new Error('billing unavailable');
      if (options.prepay === null) return null;
      return { key: `image:${input.images}`, micros: input.images * 20_000, images: input.images };
    },
    refund: async (prepayment, missing) => {
      refunds.push({ prepayment, missing });
      return true;
    },
    recordFree: async input => { freeRecords.push(input); },
    prepays,
    refunds,
    freeRecords,
  };
}

const request = (overrides: Partial<Parameters<typeof generateImages>[0]> = {}) => ({
  userId: randomUUID(),
  prompt: '水墨山居',
  size: '1024x1024' as const,
  count: 2,
  model: imageConfig(),
  ...overrides,
});

function deps(
  db: ReturnType<typeof fakeDb>,
  store: ReturnType<typeof memoryStore>,
  model: ImageModel,
  charges = billing(),
): ImageGenerationDeps {
  return {
    db: db.db, store: store.store, createModel: () => model,
    prepay: charges.prepay, refund: charges.refund, recordFree: charges.recordFree,
  };
}

test('generation prepays every image, stores bytes and records each row', async () => {
  const db = fakeDb(), storage = memoryStore(), charges = billing();
  const result = await generateImages(request({ userId: 'user-1' }), deps(db, storage, imageModel((_call, n) => n), charges));

  assert.equal(result.images.length, 2);
  assert.equal(result.costMicros, 40_000);
  assert.equal(charges.prepays.length, 1);
  assert.deepEqual(charges.prepays[0], {
    userId: 'user-1', model: imageConfig(), images: 2,
  });
  assert.deepEqual(charges.refunds, []);
  assert.equal(db.inserts.length, 2);
  for (const [index, image] of result.images.entries()) {
    assert.match(image.id, /^[0-9a-f-]{36}$/u);
    assert.equal(image.size, '1024x1024');
    assert.equal(image.mimeType, 'image/png');
    assert.equal(image.url, `/api/images/${image.id}`);
    const row = db.inserts[index]!;
    assert.equal(row.user_id, 'user-1');
    assert.equal(row.model_id, 'image-fixture');
    assert.equal(row.prompt, '水墨山居');
    assert.equal(row.size, '1024x1024');
    assert.equal(row.mime_type, 'image/png');
    assert.equal(row.bytes, PNG.length);
    assert.equal(row.sha256, createHash('sha256').update(PNG).digest('hex'));
    const object = storage.objects.get(`${GENERATED_IMAGE_BUCKET}/user-1/${image.id}.png`);
    assert.ok(object, 'the bytes land in the generated-images bucket under the owner');
    assert.equal(object.contentType, 'image/png');
  }
});

test('a failed source fails over to the next one', async () => {
  const db = fakeDb(), storage = memoryStore(), charges = billing();
  const models = [imageModel(0, 1), imageModel(1, 1)];
  const result = await generateImages(request({ count: 1, model: imageConfig(2) }), {
    db: db.db, store: storage.store, createModel: () => models.shift() ?? imageModel(1, 1),
    prepay: charges.prepay, refund: charges.refund, recordFree: charges.recordFree,
  });
  assert.equal(result.images.length, 1);
  assert.equal(db.inserts.length, 1);
  assert.equal(charges.prepays.length, 1, 'one prepayment covers the whole call');
  assert.deepEqual(charges.refunds, []);
});

test('when every source fails the whole prepayment is refunded and nothing is stored', async () => {
  const db = fakeDb(), storage = memoryStore(), charges = billing();
  await assert.rejects(
    () => generateImages(request({ count: 2, model: imageConfig(2) }), deps(db, storage, imageModel(0, 1), charges)),
    (error: unknown) => error instanceof ImageGenerationError && error.code === 'FAILED',
  );
  assert.equal(charges.prepays.length, 1);
  assert.deepEqual(charges.refunds, [{ prepayment: { key: 'image:2', micros: 40_000, images: 2 }, missing: 2 }]);
  assert.equal(db.inserts.length, 0);
  assert.equal(storage.objects.size, 0);
});

test('a source returning fewer images refunds only the undelivered ones', async () => {
  const db = fakeDb(), storage = memoryStore(), charges = billing();
  const result = await generateImages(request({ count: 2 }), deps(db, storage, imageModel(1, 2), charges));
  assert.equal(result.images.length, 1);
  assert.equal(result.costMicros, 20_000);
  assert.deepEqual(charges.refunds, [{ prepayment: { key: 'image:2', micros: 40_000, images: 2 }, missing: 1 }]);
});

test('storage failures before the row is written refund the whole prepayment', async () => {
  const db = fakeDb(), storage = memoryStore(), charges = billing();
  storage.store.put = async () => { throw new Error('disk full'); };
  await assert.rejects(() => generateImages(request(), deps(db, storage, imageModel((_call, n) => n), charges)),
    (error: unknown) => error instanceof ImageGenerationError && error.code === 'FAILED');
  assert.deepEqual(charges.refunds, [{ prepayment: { key: 'image:2', micros: 40_000, images: 2 }, missing: 2 }]);
  assert.equal(db.inserts.length, 0);
});

test('insufficient balance stops before any model call', async () => {
  const db = fakeDb(), storage = memoryStore(), charges = billing({ prepay: 'insufficient' });
  let created = 0;
  await assert.rejects(() => generateImages(request(), {
    db: db.db, store: storage.store, prepay: charges.prepay, refund: charges.refund,
    createModel: () => { created += 1; return imageModel(1); },
  }), (error: unknown) => error instanceof ImageGenerationError && error.code === 'INSUFFICIENT_BALANCE');
  assert.equal(created, 0);
  assert.equal(db.inserts.length, 0);
});

test('a prepayment backend failure is reported without starting generation', async () => {
  const db = fakeDb(), storage = memoryStore(), charges = billing({ prepay: 'failed' });
  let created = 0;
  await assert.rejects(() => generateImages(request(), {
    db: db.db, store: storage.store, prepay: charges.prepay, refund: charges.refund,
    createModel: () => { created += 1; return imageModel(1); },
  }), (error: unknown) => error instanceof ImageGenerationError && error.code === 'FAILED' && /扣费失败/u.test(error.message));
  assert.equal(created, 0);
  assert.equal(db.inserts.length, 0);
});

test('a run may spend at most four images and a free model is recorded at zero', async () => {
  const used = fakeDb({ runImages: 3 }), storage = memoryStore(), charges = billing();
  await assert.rejects(() => generateImages(request({ runId: randomUUID(), count: 2 }), deps(used, storage, imageModel(1), charges)),
    (error: unknown) => error instanceof ImageGenerationError && error.code === 'INVALID' && /4 张/.test(error.message));
  assert.equal(charges.prepays.length, 0, 'the limit is checked before prepaying');

  const free = fakeDb(), freeStorage = memoryStore(), freeCharges = billing({ prepay: null });
  const userId = randomUUID();
  const freeModel = imageConfig(1, { pricing: { ...PRICED, image: 0 } });
  const result = await generateImages(request({ userId, model: freeModel }), deps(free, freeStorage, imageModel((_call, n) => n), freeCharges));
  assert.equal(result.images.length, 2);
  assert.equal(result.costMicros, 0);
  assert.deepEqual(freeCharges.refunds, []);
  assert.equal(freeCharges.freeRecords.length, 1);
  const recorded = freeCharges.freeRecords[0] as Record<string, unknown>;
  assert.equal(recorded.userId, userId);
  assert.equal(recorded.images, 2);
  assert.deepEqual(recorded.model, freeModel);
});

test('invalid requests are refused before prepaying or calling a model', async (t: TestContext) => {
  const db = fakeDb(), storage = memoryStore(), charges = billing();
  let created = 0;
  for (const overrides of [{ count: 5 }, { count: 0 }, { size: '10x10' as never }, { prompt: '   ' }]) {
    await assert.rejects(() => generateImages(request(overrides), {
      db: db.db, store: storage.store, prepay: charges.prepay, refund: charges.refund,
      createModel: () => { created += 1; return imageModel(1); },
    }), ImageGenerationError, JSON.stringify(overrides));
  }
  assert.equal(charges.prepays.length, 0);
  assert.equal(created, 0);
  t.diagnostic('invalid requests never reach the billing ledger or the model');
});

test('an image object whose row is gone is removed once it is a day old', async () => {
  const kept = `${randomUUID()}/kept.png`;
  const orphaned = `${randomUUID()}/gone.png`;
  const fresh = `${randomUUID()}/fresh.png`;
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const entries = [
    { key: kept, size: PNG.length, mtime: old },
    { key: orphaned, size: PNG.length, mtime: old },
    { key: fresh, size: PNG.length, mtime: new Date() },
  ];
  const deleted: string[] = [];
  let olderThan: Date | undefined;
  const store = {
    async list(_bucket: string, options?: { olderThan?: Date }) {
      olderThan = options?.olderThan;
      return entries.filter(entry => !options?.olderThan || entry.mtime < options.olderThan);
    },
    async delete(_bucket: string, keys: readonly string[]) { deleted.push(...keys); },
  } as unknown as ObjectStore;
  const queried: string[][] = [];
  const db = {
    tx: async (work: (trx: unknown) => unknown) => work({
      selectFrom: () => ({
        select: () => ({
          where: (_field: string, _operator: string, values: string[]) => {
            queried.push(values);
            return { execute: async () => values.filter(value => value === kept).map(value => ({ object_path: value })) };
          },
        }),
      }),
    }),
  } as unknown as ScopedDb;

  assert.equal(await cleanupGeneratedImages({ db, store }), 1);
  assert.deepEqual(deleted, [orphaned]);
  assert.deepEqual(queried.flat().sort(), [kept, orphaned].sort(), 'only objects older than a day are compared');
  assert.ok(olderThan && olderThan.getTime() < Date.now() - 23 * 60 * 60 * 1000, 'young objects are left alone');
});
