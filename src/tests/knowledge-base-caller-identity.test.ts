import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockAuthContext } from './helpers/supabase-mock';

const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
const membership = require('../lib/user/membership-server') as typeof import('../lib/user/membership-server');
const featureGate = require('../lib/feature-gate-utils') as typeof import('../lib/feature-gate-utils');
const dataSources = require('../lib/data-sources') as typeof import('../lib/data-sources');
const search = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
const ingestRoute = require('../app/api/knowledge-base/ingest/route') as typeof import('../app/api/knowledge-base/ingest/route');
const uploadRoute = require('../app/api/knowledge-base/upload/route') as typeof import('../app/api/knowledge-base/upload/route');
const searchRoute = require('../app/api/knowledge-base/search/route') as typeof import('../app/api/knowledge-base/search/route');

type RpcCall = { name: string; args: Record<string, unknown> };

function setup(t: TestContext, options: { ownsKb?: boolean; ownsSource?: boolean } = {}) {
    const calls: RpcCall[] = [];
    const ownerFilters: Array<[string, unknown]> = [];
    const db = {
        from: (table: string) => {
            assert.equal(table, 'knowledge_bases');
            const query = {
                select: () => query,
                eq: (column: string, value: unknown) => { ownerFilters.push([column, value]); return query; },
                maybeSingle: async () => ({ data: options.ownsKb === false ? null : { id: 'kb-1', user_id: 'caller-1' }, error: null }),
            };
            return query;
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
            calls.push({ name, args });
            return { data: name === 'kb_replace_source_entries' ? 1 : [], error: null };
        },
    };
    const auth = createMockAuthContext(db, 'caller-1');
    auth.accessToken = 'caller-token';
    t.mock.method(apiUtils, 'requireUserContext', async () => auth);
    t.mock.method(featureGate, 'ensureFeatureRouteEnabled', async () => null);
    t.mock.method(membership, 'getEffectiveMembershipType', async () => 'plus');
    t.mock.method(membership, 'resolveTokenMembership', async () => 'plus');
    t.mock.method(apiUtils, 'createAuthedClient', (token: string) => {
        assert.equal(token, 'caller-token');
        return auth.db;
    });
    const messages = [{ id: 'u1', role: 'user', content: 'question' }, { id: 'a1', role: 'assistant', content: 'answer' }];
    const sourceClient = {
        from: (table: string) => {
            const query = {
                select: () => query,
                eq: (column: string, value: unknown) => {
                    if (column === 'user_id') assert.equal(value, 'caller-1');
                    return query;
                },
                maybeSingle: async () => ({
                    data: options.ownsSource === false || table === 'conversation_messages' ? null
                        : table === 'conversations' ? { id: 'source-1', user_id: 'caller-1', messages }
                            : { id: 'source-1', user_id: 'caller-1', title: 'record', content: 'text', tags: [], category: 'general' },
                    error: null,
                }),
            };
            return query;
        },
        rpc: () => { throw new Error('A user-driven replacement must never use system-admin RPC'); },
    };
    // Legacy source reads retain their explicit owner filters; only the replacement identity changes.
    t.mock.method(apiUtils, 'getSystemAdminClient', () => sourceClient as unknown as ReturnType<typeof apiUtils.getSystemAdminClient>);
    t.mock.method(dataSources, 'getProvider', async () => ({
        type: 'meihua_divination', displayName: 'Meihua', list: async () => [],
        get: async (_id: string, userId: string) => { assert.equal(userId, 'caller-1'); return { id: 'source-1' }; },
        formatForAI: () => 'fixed canonical source text', summarize: () => 'fixed summary',
    }));
    return { auth, calls, ownerFilters };
}

function ingestRequest(sourceType = 'record'): NextRequest {
    return new NextRequest('http://localhost/api/knowledge-base/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kbId: 'kb-1', sourceType, sourceId: sourceType === 'chat_message' ? 'a1' : 'source-1', sourceMeta: { conversationId: 'source-1' } }),
    });
}

function uploadRequest(): NextRequest {
    const form = new FormData();
    form.set('kbId', 'kb-1');
    form.set('file', new File(['fixed text'], 'fixture.txt', { type: 'text/plain' }));
    return new NextRequest('http://localhost/api/knowledge-base/upload', { method: 'POST', body: form });
}

function searchRequest(): NextRequest {
    return new NextRequest('http://localhost/api/knowledge-base/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'fixed query', kbIds: ['kb-1'], topK: 3 }),
    });
}

test('every user ingest branch supplies caller-bound atomic replacement instead of system-admin RPC', async t => {
    for (const sourceType of ['conversation', 'record', 'chat_message', 'meihua_divination']) {
        await t.test(sourceType, async t => {
            const { calls, ownerFilters } = setup(t);
            const response = await ingestRoute.POST(ingestRequest(sourceType));
            assert.equal(response.status, 200);
            assert.equal(calls.length, 1);
            assert.equal(calls[0].name, 'kb_replace_source_entries');
            assert.equal(calls[0].args.p_source_type, sourceType === 'record' ? 'ming_record' : sourceType);
            assert.equal(calls[0].args.p_user_id, 'caller-1');
            assert.equal(calls[0].args.p_archive, true);
            assert.ok(ownerFilters.some(([column, value]) => column === 'user_id' && value === 'caller-1'));
        });
    }
});

test('upload binds the same authenticated client and performs one non-archive replacement', async t => {
    const { calls } = setup(t);
    t.mock.method(apiUtils, 'getSystemAdminClient', () => { throw new Error('Upload must not obtain a system-admin client'); });
    const response = await uploadRoute.POST(uploadRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{ name: 'kb_replace_source_entries', args: {
        p_kb_id: 'kb-1', p_source_type: 'file', p_source_id: 'fixture.txt',
        p_entries: [{ content: 'fixed text', chunk_index: 0, metadata: { file_name: 'fixture.txt', file_type: 'text/plain' } }],
        p_archive: false, p_user_id: 'caller-1',
    } }]);
});

test('missing request database context fails before ingest or upload writes', async t => {
    const { calls } = setup(t);
    t.mock.method(apiUtils, 'requireUserContext', async () => createMockAuthContext({}, 'caller-1'));
    assert.equal((await ingestRoute.POST(ingestRequest())).status, 500);
    assert.equal((await uploadRoute.POST(uploadRequest())).status, 500);
    assert.deepEqual(calls, []);
});

test('non-owner user paths cannot replace knowledge source entries', async t => {
    const { calls } = setup(t, { ownsKb: false });
    assert.equal((await ingestRoute.POST(ingestRequest())).status, 403);
    assert.equal((await uploadRoute.POST(uploadRequest())).status, 403);
    assert.deepEqual(calls, []);
});

test('free membership prevents ingest and upload replacement', async t => {
    const { calls } = setup(t);
    t.mock.method(membership, 'getEffectiveMembershipType', async () => 'free');
    assert.equal((await ingestRoute.POST(ingestRequest())).status, 403);
    assert.equal((await uploadRoute.POST(uploadRequest())).status, 403);
    assert.deepEqual(calls, []);
});

test('source ownership rejection prevents caller-bound persistence', async t => {
    const { calls } = setup(t, { ownsSource: false });
    await assert.rejects(ingestRoute.POST(ingestRequest()), /Record not found/);
    assert.deepEqual(calls, []);
});

test('search route forwards caller token to owner-scoped RPCs and never creates a system-admin client', async t => {
    const { calls } = setup(t);
    t.mock.method(apiUtils, 'getSystemAdminClient', () => { throw new Error('No search fallback'); });
    const response = await searchRoute.POST(searchRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { candidates: [], ranked: null });
    assert.deepEqual(calls.map(call => call.name), ['search_knowledge_fts', 'search_knowledge_trigram']);
    assert.deepEqual(calls[0].args.p_kb_ids, ['kb-1']);
});

test('missing search token fails closed even with a userId and paid membership', async t => {
    const { auth, calls } = setup(t);
    auth.accessToken = null;
    t.mock.method(apiUtils, 'getSystemAdminClient', () => { throw new Error('No missing-context fallback'); });
    t.mock.method(apiUtils, 'createAuthedClient', () => { throw new Error('No client may be created without token'); });
    for (const accessToken of [undefined, '', '   ']) {
        await assert.rejects(search.searchCandidates('query', { userId: 'caller-1', accessToken }), search.KnowledgeSearchContextError);
        await assert.rejects(search.searchKnowledge('query', { userId: 'caller-1', membershipType: 'plus', accessToken }), search.KnowledgeSearchContextError);
    }
    const response = await searchRoute.POST(searchRequest());
    assert.equal(response.status, 401);
    assert.match((await response.json() as { error: string }).error, /用户身份上下文/);
    assert.deepEqual(calls, []);
});
