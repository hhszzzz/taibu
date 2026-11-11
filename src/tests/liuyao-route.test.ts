import { beforeEach, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { blockRouteNetwork } from './helpers/route-mock';
import { createMockAuthContext } from './helpers/auth-mock';
import { createMockScopedDb } from './helpers/db-mock';

// The CommonJS test loader keeps imported function lookups live; no cache eviction is needed.
beforeEach((t) => {
    assert.ok('mock' in t);
    blockRouteNetwork(t);
});


function scopedLiuyao(options: {
    row?: Record<string, unknown> | null;
    captureInsert?: (payload: unknown) => void;
    captureUpdate?: (payload: unknown) => void;
} = {}) {
    const { row = null, captureInsert, captureUpdate } = options;
    return createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                assert.equal(table, 'liuyao_divinations');
                const query = {
                    select() { return query; },
                    where() { return query; },
                    async executeTakeFirst() { return row ?? undefined; },
                };
                return query;
            },
            insertInto(table: string) {
                assert.equal(table, 'liuyao_divinations');
                const query = {
                    values(payload: Record<string, unknown>) {
                        captureInsert?.(payload);
                        return query;
                    },
                    returning() { return query; },
                    async executeTakeFirst() { return { id: 'divination-1' }; },
                };
                return query;
            },
            updateTable(table: string) {
                assert.equal(table, 'liuyao_divinations');
                const query = {
                    set(payload: Record<string, unknown>) {
                        captureUpdate?.(payload);
                        return query;
                    },
                    where() { return query; },
                    returning() { return query; },
                    async execute() { return row ? [{ id: 'divination-1' }] : []; },
                };
                return query;
            },
        } as never),
    });
}

function mockScopedContext(t: Pick<TestContext, 'mock'>, scoped: unknown) {
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    return t.mock.method(apiUtils, 'requireUserContext', async () => createMockAuthContext('user-1', scoped as never));
}





test('liuyao route save returns 400 when question is provided but yongShenTargets is missing', async () => {

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            question: '测试问题',
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, '请至少选择一个分析目标');
});

test('liuyao route save returns 400 when question is not string', async () => {
    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            question: 123,
            yongShenTargets: [],
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, '问题格式错误');
});



test('liuyao route save allows missing yongShenTargets when question is empty', async (t) => {
    mockScopedContext(t, scopedLiuyao());

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            question: '',
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.success, true);
});


test('liuyao route update returns 404 when no record is updated', async (t) => {
    mockScopedContext(t, scopedLiuyao());

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'update',
            divinationId: 'missing-id',
            yongShenTargets: ['官鬼'],
        }),
    });

    const response = await POST(request);
    assert.equal(response.status, 404);
});

test('liuyao route update invalidates the cached mention after changing yongshen targets', async (t) => {
    const mentions = require('../lib/mentions') as typeof import('../lib/mentions');
    const invalidated: string[] = [];
    t.mock.method(mentions, 'invalidateMentionCache', (id: string) => { invalidated.push(id); });
    mockScopedContext(t, scopedLiuyao({ row: { id: 'divination-1' } }));

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ action: 'update', divinationId: 'divination-1', yongShenTargets: ['官鬼'] }),
    });

    const response = await POST(request);
    assert.equal(response.status, 200);
    assert.deepEqual(invalidated, ['divination-1']);
});

test('liuyao route saves a questionless cast with no targets', async (t) => {
    const inserted: Record<string, unknown>[] = [];
    mockScopedContext(t, scopedLiuyao({ captureInsert: (payload) => { inserted.push(payload as Record<string, unknown>); } }));

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({
            action: 'save',
            question: '',
            yongShenTargets: [],
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    assert.equal(response.status, 200);
    assert.equal(inserted[0]?.question, '');
    assert.equal(inserted[0]?.yongshen_targets, null);
});

test('liuyao route keeps chosen targets on a questionless cast', async (t) => {
    const inserted: Record<string, unknown>[] = [];
    mockScopedContext(t, scopedLiuyao({ captureInsert: (payload) => { inserted.push(payload as Record<string, unknown>); } }));

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ action: 'save', question: '', yongShenTargets: ['官鬼'], yaos: [], changedLines: [] }),
    });

    const response = await POST(request);
    assert.equal(response.status, 200);
    assert.deepEqual(inserted[0]?.yongshen_targets, ['官鬼']);
});

test('liuyao save writes changed_lines as jsonb and keeps yongShenTargets as a native array', async (t) => {
    const inserted: Record<string, unknown>[] = [];
    mockScopedContext(t, scopedLiuyao({ captureInsert: (payload) => { inserted.push(payload as Record<string, unknown>); } }));

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({
            action: 'save',
            question: '测试问题',
            yongShenTargets: ['官鬼'],
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [3],
        }),
    });

    const response = await POST(request);
    assert.equal(response.status, 200);
    assert.deepEqual(inserted[0]?.yongshen_targets, ['官鬼']);
    const field = inserted[0]?.changed_lines as {
        toOperationNode: () => { sqlFragments: string[]; parameters: Array<{ value: unknown }> };
    };
    const node = field.toOperationNode();
    assert.ok(node.sqlFragments.some(fragment => fragment.includes('::jsonb')));
    assert.deepEqual(node.parameters.map(parameter => parameter.value), [JSON.stringify([3])]);
});
