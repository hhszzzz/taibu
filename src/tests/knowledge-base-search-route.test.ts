import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockAuthContext } from './helpers/auth-mock';
import { KNOWLEDGE_QUERY_MAX_LENGTH } from '../lib/knowledge-base/types';

test('knowledge search rejects oversized or malformed queries before retrieval and keeps success/auth paths', async t => {
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const features = require('../lib/feature-gate-utils') as typeof import('../lib/feature-gate-utils');
    const search = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
    const auth = t.mock.method(api, 'requireUserContext', async () => createMockAuthContext());
    t.mock.method(features, 'ensureFeatureRouteEnabled', async () => null);
    const retrieval = t.mock.method(search, 'searchKnowledge', async () => []);
    const { POST } = require('../app/api/knowledge-base/search/route') as typeof import('../app/api/knowledge-base/search/route');
    const request = (body: string) => new NextRequest('http://localhost/api/knowledge-base/search', { method: 'POST', body });
    for (const body of ['{', 'null', '{}', JSON.stringify({ query: '长'.repeat(KNOWLEDGE_QUERY_MAX_LENGTH + 1) })]) {
        assert.equal((await POST(request(body))).status, 400);
    }
    assert.equal(retrieval.mock.callCount(), 0);
    assert.equal((await POST(request(JSON.stringify({ query: ' 正常检索 ' })))).status, 200);
    assert.equal(retrieval.mock.calls[0]?.arguments[0], '正常检索');
    auth.mock.mockImplementation(async () => ({ error: { message: '请先登录', status: 401 } }));
    assert.equal((await POST(request(JSON.stringify({ query: '正常检索' })))).status, 401);
    assert.equal(retrieval.mock.callCount(), 1);
});
