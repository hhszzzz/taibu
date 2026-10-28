import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';
import { parseGatewayInput, parseModelInput, formatTokenCount } from '../lib/admin/ai-catalog';

process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

const GATEWAY = '0b9d5a40-1f6c-4a8e-9d5c-6a2f1e3b4c5d';
const OTHER_GATEWAY = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const model = (overrides: Record<string, unknown> = {}) => ({
    modelKey: 'deepseek-v4', displayName: 'DeepSeek V4', vendor: 'deepseek', usageType: 'chat',
    supportsReasoning: true, thinkingFormat: 'deepseek', thinkingLevels: ['max', 'low', 'high'], defaultReasoningEffort: 'high',
    contextWindow: 1_000_000, defaultMaxTokens: 32_768,
    sources: [{ gatewayId: GATEWAY, modelIdOverride: 'deepseek-v4', reasoningModelId: ' ', isEnabled: true }],
    ...overrides,
});

test('model input keeps the thinking ladder in order and only allows a listed default level', () => {
    const parsed = parseModelInput(model());
    assert.ok('value' in parsed);
    assert.deepEqual(parsed.value.thinkingLevels, ['low', 'high', 'max']);
    assert.equal(parsed.value.defaultReasoningEffort, 'high');
    assert.equal(parsed.value.contextWindow, 1_000_000);
    // An override equal to the model ID inherits it; a blank reasoning model is none.
    assert.deepEqual(parsed.value.sources, [{ gatewayId: GATEWAY, modelIdOverride: null, reasoningModelId: null, isEnabled: true }]);

    assert.match((parseModelInput(model({ defaultReasoningEffort: 'medium' })) as { error: string }).error, /勾选的等级/u);
    assert.match((parseModelInput(model({ thinkingLevels: ['extreme'] })) as { error: string }).error, /思考等级/u);
    assert.match((parseModelInput(model({ thinkingFormat: 'reasoning_object' })) as { error: string }).error, /参数格式/u);
    assert.match((parseModelInput(model({ defaultMaxTokens: 2_000_000 })) as { error: string }).error, /小于上下文窗口|正整数/u);
    assert.match((parseModelInput(model({ contextWindow: 100 })) as { error: string }).error, /上下文窗口/u);
    assert.match((parseModelInput(model({ sources: [{ gatewayId: GATEWAY }, { gatewayId: GATEWAY }] })) as { error: string }).error, /只能添加一次/u);
    assert.match((parseModelInput(model({ customParameters: [1] })) as { error: string }).error, /JSON 对象/u);
    assert.match((parseModelInput(model({ customParameters: { promptCacheKey: 'yes' } })) as { error: string }).error, /提示缓存开关/u);
    assert.ok('value' in parseModelInput(model({ customParameters: { promptCacheKey: true } })));
    assert.match((parseModelInput(model({ modelKey: 'has space' })) as { error: string }).error, /空格/u);

    // 生图模型按张扣积分：默认 1，可设 0 到 1000 的整数。
    const image = parseModelInput(model({ usageType: 'image', creditCost: 5, supportsReasoning: false }));
    assert.ok('value' in image);
    assert.equal(image.value.creditCost, 5);
    assert.equal((parseModelInput(model()) as { value: { creditCost: number } }).value.creditCost, 1);
    assert.match((parseModelInput(model({ usageType: 'image', creditCost: -1 })) as { error: string }).error, /每张图积分/u);
    assert.match((parseModelInput(model({ usageType: 'image', creditCost: 1.5 })) as { error: string }).error, /每张图积分/u);

    // A model without thinking stores no levels and no default.
    const plain = parseModelInput(model({ supportsReasoning: false, isReasoningDefault: true }));
    assert.ok('value' in plain);
    assert.deepEqual([plain.value.thinkingLevels, plain.value.defaultReasoningEffort, plain.value.isReasoningDefault], [[], null, false]);
});

test('gateway input checks the identifier, the address and the write-only key', () => {
    const valid = parseGatewayInput({ gatewayKey: 'main-1', displayName: '主网关', baseUrl: 'https://api.example.com/v1/', apiKey: ' sk-123 ' }, { creating: true });
    assert.ok('value' in valid);
    assert.equal(valid.value.baseUrl, 'https://api.example.com/v1');
    assert.equal(valid.value.apiKey, 'sk-123');
    assert.equal('apiKey' in (parseGatewayInput({ displayName: 'x', baseUrl: 'https://a.example' }, { creating: false }) as { value: object }).value, false);
    assert.equal((parseGatewayInput({ displayName: 'x', baseUrl: 'https://a.example', apiKey: null }, { creating: false }) as { value: { apiKey: unknown } }).value.apiKey, null);
    assert.ok('error' in parseGatewayInput({ gatewayKey: 'Main', displayName: 'x', baseUrl: 'https://a.example' }, { creating: true }));
    assert.ok('error' in parseGatewayInput({ gatewayKey: 'main', displayName: 'x', baseUrl: 'ftp://a.example' }, { creating: true }));
    assert.ok('error' in parseGatewayInput({ gatewayKey: 'main', displayName: 'x', baseUrl: 'https://user:pass@a.example' }, { creating: true }));
    assert.deepEqual([formatTokenCount(1_000_000), formatTokenCount(32_768), formatTokenCount(128_000), formatTokenCount(null)], ['1M', '32K', '128K', '—']);
});

test('a gateway key is sealed to its row: stored only as ciphertext with a hint, and it does not open for another gateway', async (t) => {
    const context = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
    const config = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
    const secrets = require('../lib/ai/gateway-secrets.server') as typeof import('../lib/ai/gateway-secrets.server');
    let inserted: Record<string, unknown> | null = null;
    t.mock.method(context, 'systemDb', () => createMockScopedDb({
        tx: async (work) => work({
            insertInto: (table: string) => {
                assert.equal(table, 'ai_gateways');
                return { values: (values: Record<string, unknown>) => ({ execute: async () => { inserted = values; } }) };
            },
        } as never),
    }) as never);
    t.mock.method(config, 'clearModelCache', () => {});
    const { createGateway } = await import('../lib/admin/ai-catalog.server');
    const id = await createGateway({ gatewayKey: 'main', displayName: '主网关', baseUrl: 'https://api.example.com', notes: null, isEnabled: true, apiKey: 'sk-live-0123456789abcd' });

    const row = inserted as unknown as { id: string; api_key_secret: unknown; api_key_hint: string };
    assert.equal(row.id, id);
    assert.equal(row.api_key_hint, 'sk-…abcd');
    assert.doesNotMatch(JSON.stringify(row), /0123456789/u);
    assert.equal(secrets.openGatewayApiKey(id, row.api_key_secret), 'sk-live-0123456789abcd');
    assert.throws(() => secrets.openGatewayApiKey(OTHER_GATEWAY, row.api_key_secret), /AI_GATEWAY_KEY_INVALID/u);
    assert.equal(secrets.sourceApiKeyOrNone({ gatewayId: OTHER_GATEWAY, apiKeySecret: row.api_key_secret as never }), undefined);
    assert.equal(secrets.resolveSourceApiKey({ gatewayId: id, apiKeySecret: null }), undefined);
});

function catalogRoutes(t: TestContext, admin = true) {
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const store = require('../lib/admin/ai-catalog.server') as typeof import('../lib/admin/ai-catalog.server');
    t.mock.method(api, 'requireAdminUser', async () => (admin ? { user: { id: 'admin-1' } } : { error: { message: '无权限操作', status: 403 } }) as never);
    const calls: Array<[string, unknown[]]> = [];
    for (const name of ['createModel', 'updateModel', 'setModelEnabled', 'deleteModel', 'createGateway', 'updateGateway', 'deleteGateway', 'listModels', 'listGateways'] as const) {
        t.mock.method(store, name, async (...args: unknown[]) => { calls.push([name, args]); return name.startsWith('list') ? [] : name.startsWith('create') ? 'new-id' : undefined; });
    }
    return { calls, store };
}
const request = (url: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

test('catalog routes write only validated input and refuse non-administrators before any write', async (t) => {
    const { calls, store } = catalogRoutes(t);
    const models = await import('../app/api/admin/ai-models/route');
    const modelDetail = await import('../app/api/admin/ai-models/[id]/route');
    const gateways = await import('../app/api/admin/ai-gateways/route');
    const gatewayDetail = await import('../app/api/admin/ai-gateways/[id]/route');

    assert.equal((await models.POST(request('/api/admin/ai-models', 'POST', model()))).status, 201);
    assert.deepEqual((calls.at(-1)![1][0] as { thinkingLevels: string[] }).thinkingLevels, ['low', 'high', 'max']);
    assert.equal((await modelDetail.PUT(request('/api/admin/ai-models/m1', 'PUT', model()), params('m1'))).status, 200);
    assert.equal(calls.at(-1)![1][0], 'm1');
    assert.equal((await modelDetail.PATCH(request('/api/admin/ai-models/m1', 'PATCH', { isEnabled: false }), params('m1'))).status, 200);
    assert.deepEqual(calls.at(-1), ['setModelEnabled', ['m1', false]]);
    assert.equal((await gateways.POST(request('/api/admin/ai-gateways', 'POST', { gatewayKey: 'main', displayName: '主', baseUrl: 'https://a.example', apiKey: 'sk-1' }))).status, 201);
    assert.equal((await gatewayDetail.PUT(request('/api/admin/ai-gateways/g1', 'PUT', { displayName: '主', baseUrl: 'https://a.example' }), params('g1'))).status, 200);
    assert.equal((calls.at(-1)![1][1] as { apiKey?: unknown }).apiKey, undefined, 'a save without a key keeps the saved one');

    const writes = calls.length;
    assert.equal((await models.POST(request('/api/admin/ai-models', 'POST', model({ thinkingFormat: 'reasoning_effort' })))).status, 400);
    assert.equal((await modelDetail.PATCH(request('/api/admin/ai-models/m1', 'PATCH', { displayName: 'x' }), params('m1'))).status, 400);
    assert.equal((await gateways.POST(request('/api/admin/ai-gateways', 'POST', { gatewayKey: 'NEWAPI', displayName: '主', baseUrl: 'https://a.example' }))).status, 400);
    assert.equal((await models.POST(new NextRequest('http://localhost/api/admin/ai-models', { method: 'POST', body: '{' }))).status, 400);
    assert.equal(calls.length, writes);

    t.mock.method(store, 'deleteGateway', async () => { throw new store.CatalogError('还有 2 个模型经这个网关调用', 409); });
    const conflict = await gatewayDetail.DELETE(request('/api/admin/ai-gateways/g1', 'DELETE'), params('g1'));
    assert.equal(conflict.status, 409);
    assert.match((await conflict.json()).error, /2 个模型/u);
});

test('catalog routes stop at the administrator check', async (t) => {
    const { calls } = catalogRoutes(t, false);
    const models = await import('../app/api/admin/ai-models/route');
    const gateways = await import('../app/api/admin/ai-gateways/route');
    const probe = await import('../app/api/admin/ai-gateways/probe/route');
    for (const response of [
        await models.GET(request('/api/admin/ai-models', 'GET')),
        await models.POST(request('/api/admin/ai-models', 'POST', model())),
        await gateways.GET(request('/api/admin/ai-gateways', 'GET')),
        await probe.POST(request('/api/admin/ai-gateways/probe', 'POST', { baseUrl: 'https://a.example', apiKey: 'sk' })),
    ]) assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
});

test('a gateway probe lists model IDs from /v1/models and reports a rejected key without its text', async (t) => {
    catalogRoutes(t);
    const seen: Array<{ url: string; auth: string | null }> = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
        seen.push({ url: String(url), auth: new Headers(init.headers).get('Authorization') });
        return String(url).includes('bad')
            ? new Response('{"error":"invalid key sk-bad"}', { status: 401 })
            : Response.json({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }, { nope: 1 }] });
    });
    const probe = await import('../app/api/admin/ai-gateways/probe/route');
    const ok = await (await probe.POST(request('/api/admin/ai-gateways/probe', 'POST', { baseUrl: 'https://good.example/v1/', apiKey: 'sk-good' }))).json();
    assert.deepEqual([ok.ok, ok.models], [true, ['a-model', 'b-model']]);
    assert.deepEqual(seen[0], { url: 'https://good.example/v1/models', auth: 'Bearer sk-good' });
    const rejected = await (await probe.POST(request('/api/admin/ai-gateways/probe', 'POST', { baseUrl: 'https://bad.example', apiKey: 'sk-bad' }))).json();
    assert.equal(seen[1].url, 'https://bad.example/v1/models');
    assert.deepEqual([rejected.ok, rejected.message], [false, '网关拒绝了这个密钥']);
});
