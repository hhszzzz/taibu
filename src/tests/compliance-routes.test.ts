import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { mockAIFeatureState } from './helpers/route-mock';


test('billing redeem rejects a non-string code with 400 before spending a rate slot', async (t) => {
    mockAIFeatureState(t);
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const rateLimit = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
    t.mock.method(apiUtils, 'requireUserContext', async () => ({ user: { id: 'user-1' }, db: {} }) as never);
    const limiter = t.mock.method(rateLimit, 'checkRateLimit', async () => ({ allowed: true, remaining: 9, resetTime: 0 }));

    const { POST } = await import('../app/api/billing/redeem/route');
    for (const code of [123, '   ', null]) {
        const response = await POST(new NextRequest('http://localhost/api/billing/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        }));
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, '请输入兑换码');
    }
    assert.equal(limiter.mock.callCount(), 0);
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
