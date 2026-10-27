import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { MockImageModelV3 } from 'ai/test';
import type { ImageModel } from 'ai';
import type { AIModelConfig } from '../types';
import type { ScopedDb } from '../lib/db/context.server';
import type { ObjectStore } from '../lib/storage/object-store';
import {
  GENERATED_IMAGE_BUCKET,
  ImageGenerationError,
  generateImages,
  type ImageGenerationDeps,
} from '../lib/ai/image-generation.server';

const sealed = { version: 1 as const, iv: 'aXY=', tag: 'dGFn', data: 'c2VhbGVk' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

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
    supportsReasoning: false, requiredTier: 'free', creditCost: 2,
    sources: Array.from({ length: sources }, (_, index) => ({
      sourceKey: `gw-${index}`, sourceName: `gw-${index}`, gatewayId: `gateway-${index}`,
      apiUrl: 'https://gateway.example/v1', apiKeySecret: sealed, isEnabled: true,
    })),
    ...overrides,
  };
}

function fakeDb(options: { charge?: number | null; runImages?: number; chargeThrows?: boolean } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
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
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'decrement_ai_chat_count_by') {
        if (options.chargeThrows) throw new Error('credit backend down');
        return options.charge === undefined ? 8 : options.charge;
      }
      if (name === 'increment_ai_chat_count') return 12;
      throw new Error(`unexpected rpc ${name}`);
    },
  } as unknown as ScopedDb;
  return { db, calls, inserts, deletes };
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

const request = (overrides: Partial<Parameters<typeof generateImages>[0]> = {}) => ({
  userId: randomUUID(),
  prompt: '水墨山居',
  size: '1024x1024' as const,
  count: 2,
  model: imageConfig(),
  ...overrides,
});

function deps(db: ReturnType<typeof fakeDb>, store: ReturnType<typeof memoryStore>, model: ImageModel): ImageGenerationDeps {
  return { db: db.db, store: store.store, createModel: () => model };
}

test('generation charges per image, stores bytes and records each row', async () => {
  const db = fakeDb({ charge: 8 }), storage = memoryStore();
  const result = await generateImages(request({ userId: 'user-1' }), deps(db, storage, imageModel((_call, n) => n)));

  assert.equal(result.images.length, 2);
  assert.equal(result.remaining, 8);
  assert.deepEqual(db.calls.map(call => [call.name, call.args]), [['decrement_ai_chat_count_by', { user_id: 'user-1', amount: 4 }]]);
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
  const db = fakeDb({ charge: 6 }), storage = memoryStore();
  const models = [imageModel(0, 1), imageModel(1, 1)];
  const result = await generateImages(request({ count: 1, model: imageConfig(2) }), {
    db: db.db, store: storage.store, createModel: () => models.shift() ?? imageModel(1, 1),
  });
  assert.equal(result.images.length, 1);
  assert.equal(db.inserts.length, 1);
  assert.equal(db.calls.length, 1, 'one charge covers the whole call');
});

test('when every source fails the whole charge is refunded and nothing is stored', async () => {
  const db = fakeDb({ charge: 10 }), storage = memoryStore();
  await assert.rejects(
    () => generateImages(request({ count: 2, model: imageConfig(2) }), deps(db, storage, imageModel(0, 1))),
    (error: unknown) => error instanceof ImageGenerationError && error.code === 'FAILED',
  );
  assert.deepEqual(db.calls.map(call => call.name), ['decrement_ai_chat_count_by', 'increment_ai_chat_count']);
  assert.deepEqual(db.calls[1]!.args, { user_id: db.calls[0]!.args.user_id, amount: 4 });
  assert.equal(db.inserts.length, 0);
  assert.equal(storage.objects.size, 0);
});

test('a source returning fewer images refunds only the undelivered ones', async () => {
  const db = fakeDb({ charge: 8 }), storage = memoryStore();
  const result = await generateImages(request({ count: 2 }), deps(db, storage, imageModel(1, 2)));
  assert.equal(result.images.length, 1);
  assert.equal(result.remaining, 10);
  assert.deepEqual(db.calls.map(call => call.name), ['decrement_ai_chat_count_by', 'increment_ai_chat_count']);
  assert.equal(db.calls[1]!.args.amount, 2);
});

test('storage failures before the row is written refund the charge', async () => {
  const db = fakeDb({ charge: 8 }), storage = memoryStore();
  storage.store.put = async () => { throw new Error('disk full'); };
  await assert.rejects(() => generateImages(request(), deps(db, storage, imageModel((_call, n) => n))),
    (error: unknown) => error instanceof ImageGenerationError && error.code === 'FAILED');
  assert.deepEqual(db.calls.map(call => call.name), ['decrement_ai_chat_count_by', 'increment_ai_chat_count']);
  assert.equal(db.inserts.length, 0);
});

test('insufficient credits stop before any model call', async () => {
  const db = fakeDb({ charge: null }), storage = memoryStore();
  let created = 0;
  await assert.rejects(() => generateImages(request(), { db: db.db, store: storage.store, createModel: () => { created += 1; return imageModel(1); } }),
    (error: unknown) => error instanceof ImageGenerationError && error.code === 'INSUFFICIENT_CREDITS');
  assert.equal(created, 0);
  assert.equal(db.inserts.length, 0);
});

test('a run may spend at most four images and a free model charges nothing', async () => {
  const used = fakeDb({ runImages: 3 }), storage = memoryStore();
  await assert.rejects(() => generateImages(request({ runId: randomUUID(), count: 2 }), deps(used, storage, imageModel(1))),
    (error: unknown) => error instanceof ImageGenerationError && error.code === 'INVALID' && /4 张/.test(error.message));
  assert.equal(used.calls.length, 0, 'the limit is checked before charging');

  const free = fakeDb({ charge: 8 }), freeStorage = memoryStore();
  const result = await generateImages(request({ model: imageConfig(1, { creditCost: 0 }) }), deps(free, freeStorage, imageModel((_call, n) => n)));
  assert.equal(result.images.length, 2);
  assert.equal(result.remaining, null);
  assert.equal(free.calls.length, 0, 'a zero-cost model never touches the ledger');
});

test('invalid requests are refused before charging', async (t: TestContext) => {
  const db = fakeDb(), storage = memoryStore();
  for (const overrides of [{ count: 5 }, { count: 0 }, { size: '10x10' as never }, { prompt: '   ' }]) {
    await assert.rejects(() => generateImages(request(overrides), deps(db, storage, imageModel(1))), ImageGenerationError, JSON.stringify(overrides));
  }
  assert.equal(db.calls.length, 0);
  t.diagnostic('invalid requests never reach the credit ledger or the model');
});
