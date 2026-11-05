import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { mockAIFeatureState } from './helpers/route-mock';


test('community reports returns auth error when admin check fails', async (t) => {
    const apiUtils = require('../lib/api-utils') as any;
    const originalRequireAdminContext = apiUtils.requireAdminContext;

    apiUtils.requireAdminContext = async () => ({
        error: { message: '请先登录', status: 401 },
    });

    t.after(() => {
        apiUtils.requireAdminContext = originalRequireAdminContext;
    });

    const { GET } = await import('../app/api/community/reports/route');
    const request = new NextRequest('http://localhost/api/community/reports');
    const response = await GET(request);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.error, '请先登录');
});

test('community admin post rejects invalid action', async (t) => {
    const apiUtils = require('../lib/api-utils') as any;

    const originalRequireAdminContext = apiUtils.requireAdminContext;

    apiUtils.requireAdminContext = async () => ({
        user: { id: 'admin-1' },
    });

    t.after(() => {
        apiUtils.requireAdminContext = originalRequireAdminContext;
    });

    const { PUT } = await import('../app/api/community/posts/[id]/admin/route');
    const request = new NextRequest('http://localhost/api/community/posts/1/admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invalid', value: true }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: 'post-1' }) });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '无效操作');
});

test('community report submission is rate limited before writing a report', async (t) => {
    const apiUtils = require('../lib/api-utils') as any;
    const rateLimit = require('../lib/rate-limit') as any;
    const originalRequireUserContext = apiUtils.requireUserContext;
    const originalCheckRateLimit = rateLimit.checkRateLimit;
    let rpcCalls = 0;
    let limiterArgs: unknown[] = [];

    mockAIFeatureState(t);
    apiUtils.requireUserContext = async () => ({
        db: { rpc: async () => { rpcCalls++; return { status: 'ok', report: {} }; } },
        user: { id: 'user-1' },
    });
    rateLimit.checkRateLimit = async (...args: unknown[]) => {
        limiterArgs = args;
        return { allowed: false, remaining: 0, resetAt: new Date() };
    };
    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
        rateLimit.checkRateLimit = originalCheckRateLimit;
    });

    const { POST } = await import('../app/api/community/reports/route');
    const request = new NextRequest('http://localhost/api/community/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'post', targetId: '00000000-0000-4000-8000-000000000001', reason: 'spam' }),
    });
    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 429);
    assert.equal(payload.error, '举报过于频繁，请稍后再试');
    assert.deepEqual(limiterArgs, ['user-1', '/api/community/reports', { maxRequests: 5, windowMs: 60_000 }]);
    assert.equal(rpcCalls, 0);
});
