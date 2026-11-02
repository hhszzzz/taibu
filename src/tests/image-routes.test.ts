import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { ScopedDb } from '../lib/db/context.server';
import { createMockAuthContext } from './helpers/auth-mock';
import { mockAIFeatureState, mockAIRateLimit } from './helpers/route-mock';
import { DEFAULT_BYOK_POLICY } from '../lib/byok/config';
import type { ResolvedByokModel } from '../lib/byok/store.server';

const IMAGE_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'A'.repeat(43);
const BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const SHA = createHash('sha256').update(BYTES).digest('hex');

function modules() {
  return {
    api: require('../lib/api-utils') as typeof import('../lib/api-utils'),
    context: require('../lib/db/context.server') as typeof import('../lib/db/context.server'),
    storage: require('../lib/storage/index.server') as typeof import('../lib/storage/index.server'),
    images: require('../lib/ai/image-generation.server') as typeof import('../lib/ai/image-generation.server'),
  };
}

const PRICED = { input: null, output: null, cacheRead: null, cacheWrite: null, image: 0.02 };

const OWN_IMAGE: ResolvedByokModel = {
  id: '00000000-0000-4000-8000-0000000000b2', ref: 'byok:00000000-0000-4000-8000-0000000000b2', modelId: 'gpt-image-1', displayName: '我的生图',
  usage: 'image', supportsVision: false, thinkingLevels: [], defaultEffort: 'auto', contextWindow: null, maxOutput: null,
  connection: { id: '00000000-0000-4000-8000-0000000000c1', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', keyHint: null, updatedAt: '2026-11-02T00:00:00Z' },
  serverKey: false, openKey: () => null,
};
const OWN_STORED_IMAGE: ResolvedByokModel = {
  ...OWN_IMAGE, id: '00000000-0000-4000-8000-0000000000b4', ref: 'byok:00000000-0000-4000-8000-0000000000b4', serverKey: true, openKey: () => 'sk-stored',
  connection: { ...OWN_IMAGE.connection, id: '00000000-0000-4000-8000-0000000000c2', keyHint: 'sk-…ored' },
};
const OWN_CHAT: ResolvedByokModel = { ...OWN_IMAGE, id: '00000000-0000-4000-8000-0000000000b1', ref: 'byok:00000000-0000-4000-8000-0000000000b1', usage: 'chat', modelId: 'deepseek-chat' };

/** The member's own models; references resolve against these. */
function ownModels(t: TestContext, models: ResolvedByokModel[] = [OWN_IMAGE, OWN_STORED_IMAGE, OWN_CHAT]) {
  const store = require('../lib/byok/store.server') as typeof import('../lib/byok/store.server');
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  t.mock.method(settings, 'getByokPolicy', async () => DEFAULT_BYOK_POLICY);
  t.mock.method(store, 'resolveByokModel', async (_db: unknown, _user: string, ref: string) => models.find(model => model.ref === ref) ?? null);
}

const location = (overrides: Record<string, unknown> = {}) => ({
  object_path: `owner/${IMAGE_ID}.png`, mime_type: 'image/png', bytes: BYTES.length, sha256: SHA, ...overrides,
});

/** A scoped database double that answers the image row (or nothing) and records the filters. */
function imageDb(row: Record<string, unknown> | null) {
  const filters: Array<[string, unknown]> = [];
  const query: Record<string, unknown> = {};
  Object.assign(query, {
    select: () => query, where: (field: string, _operator: string, value: unknown) => { filters.push([field, value]); return query; },
    executeTakeFirst: async () => row,
    execute: async () => (row ? [row] : []),
  });
  const db = { scope: { kind: 'user', userId: 'owner-1' }, tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: () => query }), rpc: async () => [] } as unknown as ScopedDb;
  return { db, filters };
}

function memoryStore(t: TestContext, bytes = BYTES) {
  t.mock.method(modules().storage, 'getObjectStore', () => ({
    async get() {
      return { stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } }), size: bytes.length, mtime: new Date() };
    },
    async put() {}, async delete() {}, async list() { return []; },
  }) as never);
}

const getRequest = (query = '') => new NextRequest(`http://localhost/api/images/${IMAGE_ID}${query}`);
const params = { params: Promise.resolve({ id: IMAGE_ID }) };

test('the image route serves only the owner and checks the stored digest', async (t) => {
  const owner = randomUUID();
  memoryStore(t);
  const mine = imageDb(location());
  t.mock.method(modules().api, 'getAuthContext', async () => createMockAuthContext(owner, mine.db));
  const { GET } = await import('../app/api/images/[id]/route');
  const response = await GET(getRequest(), params);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), BYTES);
  assert.deepEqual(mine.filters, [['id', IMAGE_ID], ['user_id', owner]], 'the query is scoped to the caller');

  const other = imageDb(null);
  t.mock.method(modules().api, 'getAuthContext', async () => createMockAuthContext(randomUUID(), other.db));
  assert.equal((await GET(getRequest(), params)).status, 404, 'another account reads nothing');
});

test('a tampered object or an accidental share token is refused', async (t) => {
  const owner = randomUUID();
  memoryStore(t, Buffer.from('not the stored bytes'));
  t.mock.method(modules().api, 'getAuthContext', async () => createMockAuthContext(owner, imageDb(location()).db));
  const { GET } = await import('../app/api/images/[id]/route');
  assert.equal((await GET(getRequest(), params)).status, 404);

  memoryStore(t);
  t.mock.method(modules().api, 'getAuthContext', async () => createMockAuthContext(null, imageDb(null).db));
  assert.equal((await GET(getRequest('?share=short'), params)).status, 404, 'a malformed token never reaches the database');
});

test('a public share reads the images of its conversation', async (t) => {
  memoryStore(t);
  const rpc = t.mock.method(modules().context, 'anonDb', () => ({
    scope: { kind: 'anon' },
    tx: async () => { throw new Error('share reads go through the definer function'); },
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, 'get_shared_generated_image');
      assert.deepEqual(args, { p_token: TOKEN, p_image: IMAGE_ID });
      return [location()];
    },
  }) as unknown as ScopedDb);
  t.mock.method(modules().api, 'getAuthContext', async () => createMockAuthContext(null, imageDb(null).db));
  const { GET } = await import('../app/api/images/[id]/route');
  const response = await GET(getRequest(`?share=${TOKEN}`), params);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), BYTES);
  assert.equal(rpc.mock.callCount(), 1);
});

test('the generate route validates input, model access and ownership before charging', async (t) => {
  const { api, images } = modules();
  mockAIFeatureState(t);
  mockAIRateLimit(t);
  const conversationQuery: Record<string, unknown> = {};
  Object.assign(conversationQuery, { select: () => conversationQuery, where: () => conversationQuery, executeTakeFirst: async () => ({ id: randomUUID() }) });
  const db = { scope: { kind: 'user', userId: 'owner-1' }, tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: () => conversationQuery }), rpc: async () => [] } as unknown as ScopedDb;
  const auth = t.mock.method(api, 'requireUserContext', async () => createMockAuthContext('owner-1', db));
  const model = {
    id: 'image-fixture', name: '生图夹具', vendor: 'openai', modelId: 'gpt-image-1', apiUrl: 'https://gateway.example/v1',
    supportsReasoning: false, requiredTier: 'free', pricing: PRICED, sources: [],
  };
  t.mock.method(images, 'resolveImageModel', async () => model);
  const generated = t.mock.method(images, 'generateImages', async () => ({
    images: [{ id: IMAGE_ID, size: '1024x1024', mimeType: 'image/png', url: `/api/images/${IMAGE_ID}` }], costMicros: 20_000,
  }));
  const { POST } = await import('../app/api/images/generate/route');
  const body = { prompt: '水墨山居', size: '1024x1024', count: 2, conversationId: randomUUID() };
  const response = await POST(new NextRequest('http://localhost/api/images/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    images: [{ id: IMAGE_ID, size: '1024x1024', mimeType: 'image/png', url: `/api/images/${IMAGE_ID}` }],
    model: { id: 'image-fixture', name: '生图夹具', priceMicros: 20_000 }, costMicros: 20_000,
  });
  const call = generated.mock.calls[0]!.arguments[0] as Record<string, unknown>;
  assert.equal(call.userId, 'owner-1');
  assert.equal(call.prompt, '水墨山居');
  assert.equal(call.count, 2);
  assert.equal(call.conversationId, body.conversationId);

  for (const invalid of [{ prompt: '' }, { prompt: '画', size: '10x10' }, { prompt: '画', count: 5 }, { prompt: '画', conversationId: 'nope' }]) {
    const rejected = await POST(new NextRequest('http://localhost/api/images/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalid) }));
    assert.equal(rejected.status, 400, JSON.stringify(invalid));
  }
  assert.equal(generated.mock.callCount(), 1, 'invalid requests never generate');

  auth.mock.mockImplementation(async () => ({ error: { message: '请先登录', status: 401 } } as never));
  assert.equal((await POST(new NextRequest('http://localhost/api/images/generate', { method: 'POST', body: JSON.stringify({ prompt: '画' }) }))).status, 401);
});

test('the generate route reports missing models, foreign conversations and insufficient balance', async (t) => {
  const { api, images } = modules();
  mockAIFeatureState(t);
  mockAIRateLimit(t);
  const conversationQuery: Record<string, unknown> = {};
  let conversationExists = false;
  Object.assign(conversationQuery, { select: () => conversationQuery, where: () => conversationQuery, executeTakeFirst: async () => conversationExists ? { id: randomUUID() } : undefined });
  const db = { scope: { kind: 'user', userId: 'owner-1' }, tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: () => conversationQuery }), rpc: async () => [] } as unknown as ScopedDb;
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext('owner-1', db));
  const resolve = t.mock.method(images, 'resolveImageModel', async () => null);
  t.mock.method(images, 'generateImages', async () => ({ images: [], costMicros: 0 }));
  const { POST } = await import('../app/api/images/generate/route');
  const post = (body: unknown) => POST(new NextRequest('http://localhost/api/images/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

  assert.equal((await post({ prompt: '画' })).status, 403, 'no image model for this member');
  assert.equal(resolve.mock.callCount(), 1);

  const model = { id: 'image-fixture', name: '模型', vendor: 'openai', modelId: 'm', apiUrl: 'https://gateway.example/v1', supportsReasoning: false, requiredTier: 'free', pricing: PRICED, sources: [] };
  resolve.mock.mockImplementation(async () => model as never);
  assert.equal((await post({ prompt: '画', conversationId: randomUUID() })).status, 404, 'a conversation the caller does not own');

  conversationExists = true;
  const insufficient = t.mock.method(images, 'generateImages', async () => { throw new images.ImageGenerationError('余额不足，无法生成图片', 'INSUFFICIENT_BALANCE'); });
  const response = await post({ prompt: '画', conversationId: randomUUID() });
  assert.equal(response.status, 402);
  assert.equal((await response.json()).code, 'INSUFFICIENT_BALANCE');
  assert.equal(insufficient.mock.callCount(), 1);
});

async function imageBytes(width = 200, height = 120): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
}

function uploadRequest(fields: Record<string, string>, images: Array<{ bytes: Buffer }> = []): NextRequest {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  for (const [index, image] of images.entries()) form.append('images', new File([new Uint8Array(image.bytes)], `image-${index}.png`, { type: 'image/png' }));
  return new NextRequest('http://localhost/api/images/upload', { method: 'POST', body: form });
}

test('the upload route sniffs images from the member\'s own image model before saving them', async (t) => {
  const { api, images } = modules();
  mockAIFeatureState(t);
  mockAIRateLimit(t);
  ownModels(t);
  const conversationQuery: Record<string, unknown> = {};
  Object.assign(conversationQuery, { select: () => conversationQuery, where: () => conversationQuery, executeTakeFirst: async () => ({ id: randomUUID() }) });
  const db = { scope: { kind: 'user', userId: 'owner-1' }, tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: () => conversationQuery }), rpc: async () => [] } as unknown as ScopedDb;
  const auth = t.mock.method(api, 'requireUserContext', async () => createMockAuthContext('owner-1', db));
  const stored = t.mock.method(images, 'storeByokImages', async () => [{ id: IMAGE_ID, size: '200x120', mimeType: 'image/png', url: `/api/images/${IMAGE_ID}` }]);
  const { POST } = await import('../app/api/images/upload/route');
  const bytes = await imageBytes();
  const conversationId = randomUUID();
  const response = await POST(uploadRequest({ prompt: '自定义图', size: '1024x1024', model: OWN_IMAGE.ref, conversationId }, [{ bytes }]));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    images: [{ id: IMAGE_ID, size: '200x120', mimeType: 'image/png', url: `/api/images/${IMAGE_ID}` }],
    model: { id: OWN_IMAGE.ref, name: '我的生图', priceMicros: 0 },
  });
  const [target, files] = stored.mock.calls[0]!.arguments as unknown as [
    Record<string, unknown>, Array<Record<string, unknown>>,
  ];
  assert.deepEqual(target, { userId: 'owner-1', prompt: '自定义图', size: '1024x1024', model: OWN_IMAGE, conversationId });
  assert.equal(files.length, 1);
  assert.equal(files[0]!.mediaType, 'image/png');
  assert.equal(files[0]!.size, '200x120', 'the real dimensions are recorded, not the requested size');
  assert.equal(auth.mock.callCount(), 1);
});

test('the upload route refuses unauthenticated, malformed and non-image input, and models that are not own image models', async (t) => {
  const { api, images } = modules();
  mockAIFeatureState(t);
  mockAIRateLimit(t);
  ownModels(t);
  const db = { scope: { kind: 'user', userId: 'owner-1' }, tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: () => {
    const query: Record<string, unknown> = { select: () => query, where: () => query, executeTakeFirst: async () => null };
    return query;
  } }), rpc: async () => [] } as unknown as ScopedDb;
  const auth = t.mock.method(api, 'requireUserContext', async () => createMockAuthContext('owner-1', db));
  const store = t.mock.method(images, 'storeByokImages', async () => { assert.fail('invalid uploads must not be stored'); });
  const { POST } = await import('../app/api/images/upload/route');
  const bytes = await imageBytes();
  const base = { prompt: '图', size: '1024x1024', model: OWN_IMAGE.ref };

  auth.mock.mockImplementation(async () => ({ error: { message: '请先登录', status: 401 } } as never));
  assert.equal((await POST(uploadRequest(base, [{ bytes }]))).status, 401);
  auth.mock.mockImplementation(async () => createMockAuthContext('owner-1', db));

  assert.equal((await POST(uploadRequest(base))).status, 400, 'no image');
  assert.equal((await POST(uploadRequest({ ...base, size: '10x10' }, [{ bytes }]))).status, 400);
  assert.equal((await POST(uploadRequest({ ...base, model: '' }, [{ bytes }]))).status, 400);
  assert.equal((await POST(uploadRequest({ ...base, model: 'dall-e-3' }, [{ bytes }]))).status, 400, 'a platform model ID is not an own model');
  assert.equal((await POST(uploadRequest({ ...base, model: OWN_CHAT.ref }, [{ bytes }]))).status, 400, 'a chat model makes no images');
  assert.equal((await POST(uploadRequest(base, [{ bytes: Buffer.from('not an image') }]))).status, 400);
  assert.equal((await POST(uploadRequest(base, Array.from({ length: 5 }, () => ({ bytes }))))).status, 400);
  assert.equal((await POST(uploadRequest({ ...base, conversationId: randomUUID() }, [{ bytes }]))).status, 404, 'a conversation the caller does not own');
  assert.equal(store.mock.callCount(), 0);
});

test('the generate route sends a stored-key own image model from this server at $0, and a picked platform model by its ID', async (t) => {
  const { api, images } = modules();
  mockAIFeatureState(t);
  mockAIRateLimit(t);
  ownModels(t);
  const conversationQuery: Record<string, unknown> = {};
  Object.assign(conversationQuery, { select: () => conversationQuery, where: () => conversationQuery, executeTakeFirst: async () => ({ id: randomUUID() }) });
  const db = { scope: { kind: 'user', userId: 'owner-1' }, tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: () => conversationQuery }), rpc: async () => [] } as unknown as ScopedDb;
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext('owner-1', db));
  const resolve = t.mock.method(images, 'resolveImageModel', async () => null);
  const own = t.mock.method(images, 'generateByokImageSet', async () => ({
    images: [{ id: IMAGE_ID, size: '1024x1024', mimeType: 'image/png', url: `/api/images/${IMAGE_ID}` }], costMicros: 0,
  }));
  const { POST } = await import('../app/api/images/generate/route');
  const post = (body: unknown) => POST(new NextRequest('http://localhost/api/images/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

  const response = await post({ prompt: '水墨山居', model: OWN_STORED_IMAGE.ref });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    images: [{ id: IMAGE_ID, size: '1024x1024', mimeType: 'image/png', url: `/api/images/${IMAGE_ID}` }],
    model: { id: OWN_STORED_IMAGE.ref, name: '我的生图', priceMicros: 0 }, costMicros: 0,
  });
  const [request, deps] = own.mock.calls[0]!.arguments as unknown as [Record<string, unknown>, { fetch: unknown; userAgent?: string }];
  assert.equal(request.model, OWN_STORED_IMAGE);
  assert.equal(request.key, 'sk-stored');
  assert.equal(typeof deps.fetch, 'function', 'the provider address goes through the public-address fetch');
  assert.equal(resolve.mock.callCount(), 0, 'no platform model is looked up');

  const browserOnly = await post({ prompt: '画', model: OWN_IMAGE.ref });
  assert.equal(browserOnly.status, 400, 'a key kept in the browser cannot be used here');
  assert.match((await browserOnly.json()).error, /浏览器/);
  assert.equal((await post({ prompt: '画', model: OWN_CHAT.ref })).status, 400);
  assert.equal((await post({ prompt: '画', model: 3 })).status, 400);
  assert.equal(own.mock.callCount(), 1);

  assert.equal((await post({ prompt: '画', model: 'image-picked' })).status, 403, 'a picked platform model that is not available');
  assert.deepEqual(resolve.mock.calls.map(call => call.arguments[0]), ['image-picked']);
});

