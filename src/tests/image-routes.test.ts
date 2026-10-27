import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { ScopedDb } from '../lib/db/context.server';
import { createMockAuthContext } from './helpers/auth-mock';
import { mockAIFeatureState, mockAIRateLimit } from './helpers/route-mock';

const IMAGE_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'A'.repeat(43);
const BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const SHA = createHash('sha256').update(BYTES).digest('hex');

function modules() {
  return {
    api: require('../lib/api-utils') as typeof import('../lib/api-utils'),
    context: require('../lib/db/context.server') as typeof import('../lib/db/context.server'),
    storage: require('../lib/storage/index.server') as typeof import('../lib/storage/index.server'),
    credits: require('../lib/user/credits') as typeof import('../lib/user/credits'),
    images: require('../lib/ai/image-generation.server') as typeof import('../lib/ai/image-generation.server'),
  };
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
  const { api, credits, images } = modules();
  mockAIFeatureState(t);
  mockAIRateLimit(t);
  const conversationQuery: Record<string, unknown> = {};
  Object.assign(conversationQuery, { select: () => conversationQuery, where: () => conversationQuery, executeTakeFirst: async () => ({ id: randomUUID() }) });
  const db = { scope: { kind: 'user', userId: 'owner-1' }, tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: () => conversationQuery }), rpc: async () => [] } as unknown as ScopedDb;
  const auth = t.mock.method(api, 'requireUserContext', async () => createMockAuthContext('owner-1', db));
  t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 10, effectiveMembership: 'plus', hasCredits: true }));
  const model = {
    id: 'image-fixture', name: '生图夹具', vendor: 'openai', modelId: 'gpt-image-1', apiUrl: 'https://gateway.example/v1',
    supportsReasoning: false, requiredTier: 'free', creditCost: 2, sources: [],
  };
  t.mock.method(images, 'resolveImageModel', async () => model);
  const generated = t.mock.method(images, 'generateImages', async () => ({
    images: [{ id: IMAGE_ID, size: '1024x1024', mimeType: 'image/png', url: `/api/images/${IMAGE_ID}` }], remaining: 6,
  }));
  const { POST } = await import('../app/api/images/generate/route');
  const body = { prompt: '水墨山居', size: '1024x1024', count: 2, conversationId: randomUUID() };
  const response = await POST(new NextRequest('http://localhost/api/images/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    images: [{ id: IMAGE_ID, size: '1024x1024', mimeType: 'image/png', url: `/api/images/${IMAGE_ID}` }],
    model: { id: 'image-fixture', name: '生图夹具', creditCost: 2 }, remaining: 6,
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

test('the generate route reports missing models, foreign conversations and insufficient credits', async (t) => {
  const { api, credits, images } = modules();
  mockAIFeatureState(t);
  mockAIRateLimit(t);
  const conversationQuery: Record<string, unknown> = {};
  let conversationExists = false;
  Object.assign(conversationQuery, { select: () => conversationQuery, where: () => conversationQuery, executeTakeFirst: async () => conversationExists ? { id: randomUUID() } : undefined });
  const db = { scope: { kind: 'user', userId: 'owner-1' }, tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: () => conversationQuery }), rpc: async () => [] } as unknown as ScopedDb;
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext('owner-1', db));
  t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 0, effectiveMembership: 'free', hasCredits: false }));
  const resolve = t.mock.method(images, 'resolveImageModel', async () => null);
  t.mock.method(images, 'generateImages', async () => ({ images: [], remaining: null }));
  const { POST } = await import('../app/api/images/generate/route');
  const post = (body: unknown) => POST(new NextRequest('http://localhost/api/images/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

  assert.equal((await post({ prompt: '画' })).status, 403, 'no image model for this member');
  assert.equal(resolve.mock.callCount(), 1);

  const model = { id: 'image-fixture', name: '模型', vendor: 'openai', modelId: 'm', apiUrl: 'https://gateway.example/v1', supportsReasoning: false, requiredTier: 'free', creditCost: 1, sources: [] };
  resolve.mock.mockImplementation(async () => model as never);
  assert.equal((await post({ prompt: '画', conversationId: randomUUID() })).status, 404, 'a conversation the caller does not own');

  conversationExists = true;
  const insufficient = t.mock.method(images, 'generateImages', async () => { throw new images.ImageGenerationError('积分不足，无法生成图片', 'INSUFFICIENT_CREDITS'); });
  const response = await post({ prompt: '画', conversationId: randomUUID() });
  assert.equal(response.status, 402);
  assert.equal((await response.json()).code, 'INSUFFICIENT_CREDITS');
  assert.equal(insufficient.mock.callCount(), 1);
});
