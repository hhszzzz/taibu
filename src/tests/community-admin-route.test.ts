import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';


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
