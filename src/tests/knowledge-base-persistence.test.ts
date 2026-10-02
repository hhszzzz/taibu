import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceKnowledgeSourceEntries } from '../lib/knowledge-base/source-replacement';
import { createKnowledgeBasePersistence } from '../lib/knowledge-base/persistence.server';
import type { KnowledgeSourceChunk, KnowledgeSourcePersistence, KnowledgeSourceReplacement } from '../lib/knowledge-base/types';

type RpcCall = { name: string; args: Record<string, unknown> };

function rpcAdapter(data: unknown, error: unknown = null) {
    const calls: RpcCall[] = [];
    const client = {
        rpc: async (name: string, args: Record<string, unknown>) => {
            calls.push({ name, args });
            return { data, error };
        },
        from: () => { throw new Error('Atomic replacement must not write tables separately'); },
    };
    // Only the SDK edge is simulated; no database atomicity/RLS claim is made by these unit tests.
    const sdkClient = client as unknown as Parameters<typeof createKnowledgeBasePersistence>[0];
    const persistence = createKnowledgeBasePersistence(sdkClient);
    return { calls, persistence, client: sdkClient };
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
    const error = { code: '42501', message: 'permission denied' };
    const failure = rpcAdapter(null, error);
    await assert.rejects(replaceKnowledgeSourceEntries(failure.persistence, 'kb-1', [chunk()]), actual => actual === error);
    assert.equal(failure.calls.length, 1);
});

test('search adapter preserves exact RPC args, raw-score defaults, metadata and legacy error handling', async () => {
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
    assert.equal(vector[0].rawScore, 2);
    const failure = rpcAdapter(null, { code: '42501' });
    assert.deepEqual(await failure.persistence.searchFts('term', undefined, 20, 'english'), []);
});

test('user write facade retains caller authentication and never trusts an overridden userId', async t => {
    const kbClientModule = require('../lib/knowledge-base/client') as typeof import('../lib/knowledge-base/client');
    const ingestModule = require('../lib/knowledge-base/ingest') as typeof import('../lib/knowledge-base/ingest');
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const { client, calls } = rpcAdapter(1);
    // Authentication is the only additional SDK surface exercised by this facade.
    const userClient = { ...client, auth: { getUser: async () => ({ data: { user: { id: 'actual-user' } } }) } } as unknown as Parameters<typeof createKnowledgeBasePersistence>[0];
    t.mock.method(kbClientModule, 'createKbClient', async () => userClient);
    t.mock.method(apiUtils, 'getSystemAdminClient', () => { throw new Error('Must not upgrade user client'); });
    await ingestModule.upsertEntries('kb-1', [chunk()], { userId: 'forged-user' });
    assert.equal(calls[0].args.p_user_id, 'actual-user');
    assert.equal(calls.length, 1);
});

test('search orchestration retains RPC order, remaining trigram limit and normalization/deduplication', async t => {
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const embeddingModule = require('../lib/knowledge-base/embedding-config') as typeof import('../lib/knowledge-base/embedding-config');
    const searchModule = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
    const calls: RpcCall[] = [];
    const row = { kb_id: 'kb-1', content: 'text', metadata: {} };
    const replies: Record<string, unknown> = {
        search_knowledge_fts: [{ ...row, id: 'a', rank: 0.1 }, { ...row, id: 'b', rank: 0.3 }],
        search_knowledge_trigram: [{ ...row, id: 'a', similarity: 0.8 }],
        search_knowledge_vector: [{ ...row, id: 'b', distance: 0.5 }, { ...row, id: 'v', distance: 1 }],
    };
    const client = { rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: replies[name], error: null };
    } } as unknown as Parameters<typeof createKnowledgeBasePersistence>[0];
    t.mock.method(apiUtils, 'getSystemAdminClient', () => { throw new Error('No system-admin search fallback'); });
    const callerClient = t.mock.method(apiUtils, 'createAuthedClient', (token: string) => {
        assert.equal(token, 'caller-token');
        return client;
    });
    t.mock.method(embeddingModule, 'getEmbeddingDimensionAsync', async () => 2);
    t.mock.method(embeddingModule, 'checkVectorIndexExists', async () => true);
    t.mock.method(embeddingModule, 'generateEmbedding', async () => [0.1, 0.2]);
    const result = await searchModule.searchCandidates('term', { limit: 3, useVector: true, accessToken: 'caller-token' });
    assert.equal(callerClient.mock.callCount(), 1);
    assert.deepEqual(calls.map(call => [call.name, call.args.p_limit]), [
        ['search_knowledge_fts', 3], ['search_knowledge_trigram', 1], ['search_knowledge_vector', 3],
    ]);
    assert.deepEqual(result.map(item => [item.id, item.method, item.score]), [
        ['b', 'fts', 0.3 * 3.33], ['a', 'trigram', 0.8], ['v', 'vector', 0.5],
    ]);
});
