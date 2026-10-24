import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockAuthContext } from './helpers/auth-mock';
import { createMockScopedDb } from './helpers/db-mock';

const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
const membership = require('../lib/user/membership-server') as typeof import('../lib/user/membership-server');
const featureGate = require('../lib/feature-gate-utils') as typeof import('../lib/feature-gate-utils');
const dataSources = require('../lib/data-sources') as typeof import('../lib/data-sources');
const search = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
const ingestRoute = require('../app/api/knowledge-base/ingest/route') as typeof import('../app/api/knowledge-base/ingest/route');
const uploadRoute = require('../app/api/knowledge-base/upload/route') as typeof import('../app/api/knowledge-base/upload/route');
const searchRoute = require('../app/api/knowledge-base/search/route') as typeof import('../app/api/knowledge-base/search/route');

type RpcCall = { name: string; args: Record<string, unknown> };
type ScopeOptions = { ownsKb?: boolean; ownsSource?: boolean };

function setup(t: TestContext, options: ScopeOptions = {}) {
    const calls: RpcCall[] = [];
    const ownerFilters: Array<[string, unknown]> = [];
    const messages = [{ id: 'u1', role: 'user', content: 'question' }, { id: 'a1', role: 'assistant', content: 'answer' }];
    const scoped = createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                const query = {
                    select() { return query; },
                    where(column: string, _operator: string, value: unknown) {
                        if (column === 'user_id') ownerFilters.push([column, value]);
                        return query;
                    },
                    orderBy() { return query; },
                    limit() { return query; },
                    async execute() {
                        if (table === 'knowledge_bases') return [{ id: 'kb-1', weight: 'normal' }];
                        if (table === 'conversation_messages') return messages;
                        return [];
                    },
                    async executeTakeFirst() {
                        if (table === 'knowledge_bases') {
                            return options.ownsKb === false ? undefined : { id: 'kb-1', user_id: 'caller-1' };
                        }
                        if (table === 'conversations') {
                            return options.ownsSource === false ? undefined : { id: 'source-1', user_id: 'caller-1', messages };
                        }
                        if (table === 'ming_records') {
                            return options.ownsSource === false
                                ? undefined
                                : { id: 'source-1', user_id: 'caller-1', title: 'record', content: 'text', tags: [], category: 'general' };
                        }
                        if (table === 'conversation_messages') return undefined;
                        return undefined;
                    },
                };
                return query;
            },
        } as never),
        rpc: async (name, args) => {
            calls.push({ name, args });
            if (name === 'kb_replace_source_entries') return 1;
            return [];
        },
    });
    const auth = createMockAuthContext('caller-1', scoped);
    t.mock.method(apiUtils, 'requireUserContext', async () => auth);
    t.mock.method(featureGate, 'ensureFeatureRouteEnabled', async () => null);
    t.mock.method(membership, 'getEffectiveMembershipType', async () => 'plus');
    t.mock.method(dataSources, 'getProvider', async () => ({
        type: 'meihua_divination', displayName: 'Meihua', list: async () => [],
        get: async (_id: string, userId: string, context?: { db?: unknown }) => {
            assert.equal(userId, 'caller-1');
            assert.equal(context?.db, scoped);
            return { id: 'source-1' };
        },
        formatForAI: () => 'fixed canonical source text', summarize: () => 'fixed summary',
    }));
    return { auth, calls, ownerFilters, scoped };
}

function ingestRequest(sourceType = 'record'): NextRequest {
    return new NextRequest('http://localhost/api/knowledge-base/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kbId: 'kb-1', sourceType, sourceId: sourceType === 'chat_message' ? 'a1' : 'source-1', sourceMeta: { conversationId: 'source-1' } }),
    });
}

function uploadRequest(file = new File(['fixed text'], 'fixture.txt', { type: 'text/plain' })): NextRequest {
    const form = new FormData();
    form.set('kbId', 'kb-1');
    form.set('file', file);
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
            assert.equal('p_user_id' in calls[0].args, false, 'the caller scope decides the owner');
            assert.equal(calls[0].args.p_archive, true);
            assert.ok(ownerFilters.some(([column, value]) => column === 'user_id' && value === 'caller-1'));
        });
    }
});

test('upload binds the same authenticated client and performs one non-archive replacement', async t => {
    const { calls } = setup(t);
    const response = await uploadRoute.POST(uploadRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{ name: 'kb_replace_source_entries', args: {
        p_kb_id: 'kb-1', p_source_type: 'file', p_source_id: 'fixture.txt',
        p_entries: [{ content: 'fixed text', chunk_index: 0, metadata: { file_name: 'fixture.txt', file_type: 'text/plain' } }],
        p_archive: false,
    } }]);
});

test('missing request database context fails before ingest or upload writes', async t => {
    const calls: RpcCall[] = [];
    const brokenScoped = createMockScopedDb({
        tx: async () => { throw new Error('database unavailable'); },
        rpc: async (name, args) => { calls.push({ name, args }); return []; },
    });
    t.mock.method(apiUtils, 'requireUserContext', async () => createMockAuthContext('caller-1', brokenScoped));
    t.mock.method(featureGate, 'ensureFeatureRouteEnabled', async () => null);
    t.mock.method(membership, 'getEffectiveMembershipType', async () => 'plus');
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

test('upload rejects files the text ingester cannot read before any knowledge-base read or write', async t => {
    const { calls, ownerFilters } = setup(t);
    const rejected: Array<[File, string]> = [
        [new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' }), '只支持 .txt、.md、.csv、.json 等纯文本文件'],
        [new File([], 'empty.txt', { type: 'text/plain' }), '文件内容为空'],
    ];
    for (const [file, message] of rejected) {
        const response = await uploadRoute.POST(uploadRequest(file));
        assert.equal(response.status, 400, file.name);
        assert.equal((await response.json()).error, message);
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(ownerFilters, []);
});

test('source ownership rejection prevents caller-bound persistence', async t => {
    const { calls } = setup(t, { ownsSource: false });
    await assert.rejects(ingestRoute.POST(ingestRequest()), /Record not found/);
    assert.deepEqual(calls, []);
});

test('search route uses owner-scoped RPCs and never creates a system-admin client', async t => {
    const { calls } = setup(t);
    const response = await searchRoute.POST(searchRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { candidates: [], ranked: null });
    assert.deepEqual(calls.map(call => call.name), ['search_knowledge_fts', 'search_knowledge_trigram']);
    assert.deepEqual(calls[0].args.p_kb_ids, ['kb-1']);
});

test('missing scoped context fails closed even with a userId and paid membership', async () => {
    for (const options of [
        { userId: 'caller-1' },
        { userId: 'caller-1', membershipType: 'plus' as const },
    ]) {
        await assert.rejects(search.searchCandidates('query', options), search.KnowledgeSearchContextError);
        await assert.rejects(search.searchKnowledge('query', options), search.KnowledgeSearchContextError);
    }
});
