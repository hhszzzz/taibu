import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

test('records PUT validates and persists related chart fields', async (t) => {
    const apiUtilsModule = require('../lib/api-utils') as any;
    const routePath = require.resolve('../app/api/records/[id]/route');
    const originalRequireUserContext = apiUtilsModule.requireUserContext;
    const updatePayloads: Record<string, unknown>[] = [];

    apiUtilsModule.requireUserContext = async () => ({
        user: { id: 'user-1' },
        supabase: {
            from(table: string) {
                assert.equal(table, 'ming_records');
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            maybeSingle: async () => ({
                                                data: {
                                                    id: 'record-1',
                                                    related_chart_type: null,
                                                    related_chart_id: null,
                                                },
                                                error: null,
                                            }),
                                        };
                                    },
                                };
                            },
                        };
                    },
                    update(payload: Record<string, unknown>) {
                        updatePayloads.push(payload);
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            select: () => ({
                                                single: async () => ({
                                                    data: { id: 'record-1', ...payload },
                                                    error: null,
                                                }),
                                            }),
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            },
        },
    });
    delete require.cache[routePath];

    t.after(() => {
        apiUtilsModule.requireUserContext = originalRequireUserContext;
        delete require.cache[routePath];
    });

    const { PUT } = await import('../app/api/records/[id]/route');
    const response = await PUT(new NextRequest('http://localhost/api/records/record-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            related_chart_type: 'bazi',
            related_chart_id: '11111111-1111-1111-1111-111111111111',
        }),
    }), {
        params: Promise.resolve({ id: 'record-1' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(updatePayloads.length, 1);
    const [updatePayload] = updatePayloads;
    assert.ok(updatePayload);
    assert.equal(updatePayload.related_chart_type, 'bazi');
    assert.equal(updatePayload.related_chart_id, '11111111-1111-1111-1111-111111111111');
    assert.equal(payload.related_chart_type, 'bazi');
});

test('records POST rejects incomplete related chart payload', async (t) => {
    const apiUtilsModule = require('../lib/api-utils') as any;
    const routePath = require.resolve('../app/api/records/route');
    const originalRequireUserContext = apiUtilsModule.requireUserContext;

    apiUtilsModule.requireUserContext = async () => ({
        user: { id: 'user-1' },
        supabase: {},
    });
    delete require.cache[routePath];

    t.after(() => {
        apiUtilsModule.requireUserContext = originalRequireUserContext;
        delete require.cache[routePath];
    });

    const { POST } = await import('../app/api/records/route');
    const response = await POST(new NextRequest('http://localhost/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: '测试记录',
            related_chart_type: 'bazi',
        }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '关联命盘类型和 ID 必须同时提供');
});

test('community normalizePostInput enforces non-empty title/content for create and update', async () => {
    const { normalizePostInput } = await import('../lib/community');

    assert.deepEqual(normalizePostInput({ title: '', content: '正文' }, 'create'), {
        error: '标题和内容不能为空',
    });
    assert.deepEqual(normalizePostInput({ title: '' }, 'update'), {
        error: '标题和内容不能为空',
    });
});

test('community posts PUT reuses shared validation and rejects blank title', async (t) => {
    const apiUtilsModule = require('../lib/api-utils') as any;
    const routePath = require.resolve('../app/api/community/posts/[id]/route');
    const originalRequireUserContext = apiUtilsModule.requireUserContext;

    apiUtilsModule.requireUserContext = async () => ({
        user: { id: 'user-1' },
        supabase: {},
    });
    delete require.cache[routePath];

    t.after(() => {
        apiUtilsModule.requireUserContext = originalRequireUserContext;
        delete require.cache[routePath];
    });

    const { PUT } = await import('../app/api/community/posts/[id]/route');
    const response = await PUT(new NextRequest('http://localhost/api/community/posts/post-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '' }),
    }), {
        params: Promise.resolve({ id: 'post-1' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '标题和内容不能为空');
});

test('knowledge-base normalizeKnowledgeBaseInput shares name and weight constraints', async () => {
    const { normalizeKnowledgeBaseInput } = await import('../lib/knowledge-base/ingest');

    assert.deepEqual(normalizeKnowledgeBaseInput({ name: '', weight: 'normal' }, 'create'), {
        error: 'name 不能为空',
    });
    assert.deepEqual(normalizeKnowledgeBaseInput({ weight: 'invalid' }, 'update'), {
        error: 'weight 无效',
    });
});

test('knowledge-base PATCH reuses shared validation and rejects invalid weight', async (t) => {
    const apiUtilsModule = require('../lib/api-utils') as any;
    const featureGateModule = require('../lib/feature-gate-utils') as any;
    const routePath = require.resolve('../app/api/knowledge-base/[id]/route');
    const originalRequireUserContext = apiUtilsModule.requireUserContext;
    const originalEnsureFeatureRouteEnabled = featureGateModule.ensureFeatureRouteEnabled;

    apiUtilsModule.requireUserContext = async () => ({
        user: { id: 'user-1' },
        supabase: {},
    });
    featureGateModule.ensureFeatureRouteEnabled = async () => null;
    delete require.cache[routePath];

    t.after(() => {
        apiUtilsModule.requireUserContext = originalRequireUserContext;
        featureGateModule.ensureFeatureRouteEnabled = originalEnsureFeatureRouteEnabled;
        delete require.cache[routePath];
    });

    const { PATCH } = await import('../app/api/knowledge-base/[id]/route');
    const response = await PATCH(new NextRequest('http://localhost/api/knowledge-base/kb-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight: 'invalid' }),
    }), {
        params: Promise.resolve({ id: 'kb-1' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'weight 无效');
});
