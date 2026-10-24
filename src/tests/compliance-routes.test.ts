import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';


test('activation-keys activate rejects non-string keyCode with 400', async (t) => {
    const apiUtils = require('../lib/api-utils') as any;
    const originalRequireUserContext = apiUtils.requireUserContext;

    apiUtils.requireUserContext = async () => ({
        user: { id: 'user-1' },
        profile: null,
    });

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
    });

    const { POST } = await import('../app/api/activation-keys/route');
    const request = new NextRequest('http://localhost/api/activation-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', keyCode: 123 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '请输入激活码');
});

test('knowledge-base search rejects non-string query with 400', async (t) => {
    const apiUtils = require('../lib/api-utils') as any;
    const searchModule = require('../lib/knowledge-base/search') as any;
    const originalRequireUserContext = apiUtils.requireUserContext;
    const originalGetAccessToken = apiUtils.getAccessToken;
    const originalSearchKnowledge = searchModule.searchKnowledge;
    let called = false;

    apiUtils.requireUserContext = async () => ({
        user: { id: 'user-1' },
        profile: null,
    });
    apiUtils.getAccessToken = async () => null;
    searchModule.searchKnowledge = async () => {
        called = true;
        return [];
    };

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
        apiUtils.getAccessToken = originalGetAccessToken;
        searchModule.searchKnowledge = originalSearchKnowledge;
    });

    const { POST } = await import('../app/api/knowledge-base/search/route');
    const request = new NextRequest('http://localhost/api/knowledge-base/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 123 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'query 不能为空');
    assert.equal(called, false);
});
