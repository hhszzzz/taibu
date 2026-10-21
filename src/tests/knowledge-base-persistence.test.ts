import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceKnowledgeSourceEntries } from '../lib/knowledge-base/source-replacement';
import { createKnowledgeBasePersistence } from '../lib/knowledge-base/persistence.server';
import { createMockScopedDb } from './helpers/db-mock';
import type { KnowledgeSourceChunk, KnowledgeSourcePersistence, KnowledgeSourceReplacement } from '../lib/knowledge-base/types';

type RpcCall = { name: string; args: Record<string, unknown> };

function rpcAdapter(data: unknown, error: unknown = null) {
    const calls: RpcCall[] = [];
    const scoped = createMockScopedDb({
        rpc: async (name, args) => {
            calls.push({ name, args });
            if (error) throw error;
            return data;
        },
        tx: async () => { throw new Error('Atomic replacement must not write tables separately'); },
    });
    const persistence = createKnowledgeBasePersistence(scoped);
    return { calls, persistence, scoped };
}

function chunk(index = 0): KnowledgeSourceChunk {
    return { content: `chunk-${index}`, sourceType: 'ming_record', sourceId: 'record-1', chunkIndex: index, metadata: { tag: 'fixed' } };
}

test('single-source contiguous validation rejects invalid input before any persistence call', async () => {
    let calls = 0;
    const persistence: KnowledgeSourcePersistence = { replaceSourceEntries: async () => { calls++; return 1; } };
    await assert.rejects(replaceKnowledgeSourceEntries(persistence, 'kb-1', []), /缺少知识库来源信息/);
    for (const chunks of [
        [chunk(1)],
        [chunk(), chunk()],
        [chunk(), { ...chunk(1), sourceId: 'record-2' }],
        [chunk(), { ...chunk(1), sourceType: 'file' as const }],
    ]) {
        await assert.rejects(replaceKnowledgeSourceEntries(persistence, 'kb-1', chunks), /必须按单一来源顺序写入/);
    }
    await assert.rejects(replaceKnowledgeSourceEntries(persistence, 'kb-1', [chunk()], {
        source: { sourceType: 'ming_record', sourceId: 'different-source' },
    }), /必须按单一来源顺序写入/);
    assert.equal(calls, 0);
});

test('validated usecase delegates plain data once and honors returned counts', async () => {
    const calls: KnowledgeSourceReplacement[] = [];
    const persistence: KnowledgeSourcePersistence = {
        replaceSourceEntries: async input => { calls.push(input); return 0; },
    };
    const chunks = [chunk(), chunk(1)];
    assert.deepEqual(await replaceKnowledgeSourceEntries(persistence, 'kb-1', chunks, { userId: 'user-1' }), {
        entriesCreated: 0, chunks: 2,
    });
    assert.deepEqual(calls, [{ kbId: 'kb-1', chunks, userId: 'user-1',
        source: { sourceType: 'ming_record', sourceId: 'record-1', archive: false } }]);
});

test('source replacement and archive delegate to the exact single atomic RPC', async () => {
    const { calls, persistence } = rpcAdapter(2);
    const chunks = [chunk(), chunk(1)];
    const result = await replaceKnowledgeSourceEntries(persistence, 'kb-1', chunks, {
        userId: 'user-1', source: { sourceType: 'ming_record', sourceId: 'record-1', archive: true },
    });
    assert.deepEqual(result, { entriesCreated: 2, chunks: 2 });
    assert.deepEqual(calls, [{ name: 'kb_replace_source_entries', args: {
        p_kb_id: 'kb-1', p_source_type: 'ming_record', p_source_id: 'record-1',
        p_entries: chunks.map(c => ({ content: c.content, chunk_index: c.chunkIndex, metadata: c.metadata })),
        p_archive: true, p_user_id: 'user-1',
    } }]);
});

test('empty replacement can atomically clear/archive a known source and preserve null user default', async () => {
    const { calls, persistence } = rpcAdapter(null);
    assert.deepEqual(await replaceKnowledgeSourceEntries(persistence, 'kb-1', [], {
        source: { sourceType: 'chat_message', sourceId: 'message-1', archive: true },
    }), { entriesCreated: 0, chunks: 0 });
    assert.deepEqual(calls[0].args, {
        p_kb_id: 'kb-1', p_source_type: 'chat_message', p_source_id: 'message-1',
        p_entries: [], p_archive: true, p_user_id: null,
    });
});

test('non-numeric RPC counts keep legacy fallback and permission failures propagate unchanged without retries', async () => {
    const success = rpcAdapter('1');
    assert.deepEqual(await replaceKnowledgeSourceEntries(success.persistence, 'kb-1', [chunk()]), { entriesCreated: 1, chunks: 1 });
    assert.equal(success.calls[0].args.p_archive, false);
    const error = Object.assign(new Error('permission denied'), { code: '42501' });
    const failure = rpcAdapter(null, error);
    await assert.rejects(replaceKnowledgeSourceEntries(failure.persistence, 'kb-1', [chunk()]), actual => actual === error);
    assert.equal(failure.calls.length, 1);
});

test('search adapter preserves exact RPC args, raw-score defaults, metadata and explicit error handling', async () => {
    const { calls, persistence } = rpcAdapter([{ id: 'entry-1', kb_id: 'kb-1', content: 'text', metadata: null, rank: 0.2, similarity: 0.4, distance: 0 }]);
    const fts = await persistence.searchFts('term', ['kb-1'], 20, 'simple');
    const trigram = await persistence.searchTrigram('term', ['kb-1'], 19, 0.3);
    const vector = await persistence.searchVector([0.1, 0.2], ['kb-1'], 20, 2);
    assert.deepEqual(calls, [
        { name: 'search_knowledge_fts', args: { p_query: 'term', p_kb_ids: ['kb-1'], p_limit: 20, p_config: 'simple' } },
        { name: 'search_knowledge_trigram', args: { p_query: 'term', p_kb_ids: ['kb-1'], p_limit: 19, p_threshold: 0.3 } },
        { name: 'search_knowledge_vector', args: { p_query_vector: [0.1, 0.2], p_kb_ids: ['kb-1'], p_limit: 20, p_dim: 2 } },
    ]);
    assert.deepEqual(fts[0], { id: 'entry-1', kbId: 'kb-1', content: 'text', metadata: {}, rawScore: 0.2 });
    assert.equal(trigram[0].rawScore, 0.4);
    assert.equal(vector[0].rawScore, 0);
    const failure = rpcAdapter(null, new Error('permission denied'));
    await assert.rejects(failure.persistence.searchFts('term', undefined, 20, 'english'));
    await assert.rejects(failure.persistence.searchTrigram('term', undefined, 20, 0.3));
    await assert.rejects(failure.persistence.searchVector([1], undefined, 20, 1));
});

test('user write facade retains caller authentication and never trusts an overridden userId', async () => {
    const ingestModule = require('../lib/knowledge-base/ingest') as typeof import('../lib/knowledge-base/ingest');
    const { calls, scoped } = rpcAdapter(1);
    await ingestModule.upsertEntries('kb-1', [chunk()], scoped, { userId: 'forged-user' });
    assert.equal(calls[0].args.p_user_id, 'user-1');
    assert.equal(calls.length, 1);
});

test('search orchestration retains RPC order, remaining trigram limit and normalization/deduplication', async (t) => {
    const embeddingModule = require('../lib/knowledge-base/embedding-config') as typeof import('../lib/knowledge-base/embedding-config');
    const searchModule = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
    const calls: RpcCall[] = [];
    const row = { kb_id: 'kb-1', content: 'text', metadata: {} };
    const replies: Record<string, unknown> = {
        search_knowledge_fts: [{ ...row, id: 'a', rank: 0.1 }, { ...row, id: 'b', rank: 0.3 }],
        search_knowledge_trigram: [{ ...row, id: 'a', similarity: 0.8 }],
        search_knowledge_vector: [{ ...row, id: 'b', distance: 0.5 }, { ...row, id: 'v', distance: 1 }],
    };
    const scoped = createMockScopedDb({
        rpc: async (name, args) => {
            calls.push({ name, args });
            if (name === 'check_vector_index_exists') return true;
            return replies[name];
        },
    });
    t.mock.method(embeddingModule, 'getEmbeddingDimensionAsync', async () => 2);
    t.mock.method(embeddingModule, 'generateEmbedding', async () => [0.1, 0.2]);
    const result = await searchModule.searchCandidates('term', { limit: 3, useVector: true, db: scoped });
    assert.deepEqual(calls.filter(call => call.name.startsWith('search_knowledge_')).map(call => [call.name, call.args.p_limit]), [
        ['search_knowledge_fts', 3], ['search_knowledge_trigram', 1], ['search_knowledge_vector', 3],
    ]);
    assert.deepEqual(result.map(item => [item.id, item.method, item.score]), [
        ['b', 'fts', 0.3 * 3.33], ['a', 'trigram', 0.8], ['v', 'vector', 0.5],
    ]);
});

for (const failed of [['fts'], ['trigram'], ['fts', 'trigram']]) {
    test(`search retains successful stages and observes failures: ${failed}`, async t => {
        const search = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
        const warnings: unknown[][] = [];
        t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
        const scoped = createMockScopedDb({
            rpc: async (name) => {
                if (failed.some(stage => name.endsWith(stage))) throw new Error('PRIVATE_PROVIDER_ERROR');
                return [{ id: 'hit', kb_id: 'kb', content: 'PRIVATE_CONTENT', rank: 0.2, similarity: 0.3 }];
            },
        });
        const promise = search.searchCandidates('PRIVATE_QUERY', { db: scoped });
        if (failed.length === 2) await assert.rejects(promise, /Knowledge retrieval failed/);
        else assert.equal((await promise)[0].id, 'hit');
        assert.equal(warnings.length, failed.length);
        assert.ok(!JSON.stringify(warnings).includes('PRIVATE'));
    });
}

test('hit names reuse only matching request owner, query missing IDs, and retain standalone fallback', async (t) => {
    const search = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
    const { buildKnowledgeHits } = require('../lib/knowledge-base/hits') as typeof import('../lib/knowledge-base/hits');
    t.mock.method(search, 'searchKnowledge', async () => [
        { id: 'a', kbId: 'a', content: 'a', score: 0.8, method: 'fts', metadata: {} },
        { id: 'b', kbId: 'b', content: 'b', score: 0.4, method: 'fts', metadata: {} },
    ]);
    const queries: string[][] = [];
    const ownerFilters: unknown[] = [];
    const scoped = createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                assert.equal(table, 'knowledge_bases');
                const query = {
                    select() { return query; },
                    where(column: string, _operator: string, value: unknown) {
                        if (column === 'user_id') ownerFilters.push(value);
                        if (column === 'id') queries.push(value as string[]);
                        return query;
                    },
                    async execute() {
                        const ids = queries[queries.length - 1] ?? [];
                        return ids.map(id => ({ id, name: id }));
                    },
                };
                return query;
            },
        } as never),
    });
    const options = { query: 'question', userId: 'owner', membershipType: 'pro' as const, promptKbIds: ['a', 'b'], db: scoped };
    const standalone = await buildKnowledgeHits(options);
    assert.deepEqual(await buildKnowledgeHits({ ...options, knownNames: { userId: 'owner', names: new Map([['a', 'a'], ['b', 'b']]) } }), standalone);
    assert.deepEqual(await buildKnowledgeHits({ ...options, knownNames: { userId: 'owner', names: new Map([['a', 'a']]) } }), standalone);
    assert.deepEqual(await buildKnowledgeHits({ ...options, knownNames: { userId: 'other', names: new Map([['a', 'SECRET_OTHER']]) } }), standalone);
    assert.deepEqual(queries, [['a', 'b'], ['b'], ['a', 'b']]);
    assert.deepEqual(ownerFilters, ['owner', 'owner', 'owner']);
});

test('missing resolved identity fails closed even with no hits', async () => {
    const search = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
    await assert.rejects(search.searchCandidates('query', { userId: 'caller-1' }), search.KnowledgeSearchContextError);
    await assert.rejects(search.searchKnowledge('query', { userId: 'caller-1', membershipType: 'plus' }), search.KnowledgeSearchContextError);
});
