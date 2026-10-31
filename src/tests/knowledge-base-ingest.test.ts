import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';

const ingestModule = require('../lib/knowledge-base/ingest') as typeof import('../lib/knowledge-base/ingest');

const CHAT_MESSAGE = {
    sequence: 2,
    message_id: 'a1',
    role: 'assistant',
    content: '你好，我在',
    metadata: null,
    created_at: '2026-03-27T00:00:00.000Z',
};

const PREVIOUS_USER_MESSAGE = {
    sequence: 1,
    message_id: 'u1',
    role: 'user',
    content: '你好',
    metadata: null,
    created_at: '2026-03-27T00:00:00.000Z',
};

function messageScope(capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null }) {
    return createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                const filters: string[] = [];
                const query = {
                    select() { return query; },
                    where(column: string) { filters.push(column); return query; },
                    orderBy() { return query; },
                    limit() { return query; },
                    async executeTakeFirst() {
                        if (table === 'conversations') return { id: 'conv-1', user_id: 'user-1' };
                        if (table === 'conversation_messages') {
                            const asked = filters.join(',');
                            if (asked.includes('message_id')) return CHAT_MESSAGE;
                            if (asked.includes('role')) return PREVIOUS_USER_MESSAGE;
                        }
                        return undefined;
                    },
                    async execute() { return []; },
                };
                return query;
            },
        } as never),
        rpc: async (name, args) => {
            capture.rpcCall = { fn: name, args };
            return 1;
        },
    });
}

test('ingestChatMessageAsService stores chat_message entries with metadata', async () => {
    const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };
    const scoped = messageScope(capture);
    const result = await ingestModule.ingestChatMessageAsService('kb-1', 'conv-1', 'a1', 'user-1', scoped);
    assert.equal(result.chunks > 0, true);
    assert.equal(capture.rpcCall?.fn, 'kb_replace_source_entries');
    assert.equal(capture.rpcCall?.args.p_source_type, 'chat_message');
    assert.equal(capture.rpcCall?.args.p_source_id, 'a1');
    assert.equal(capture.rpcCall?.args.p_archive, true);
    const entries = (capture.rpcCall?.args.p_entries as Array<{ metadata: Record<string, unknown> }>) || [];
    assert.equal(entries[0]?.metadata?.conversation_id, 'conv-1');
    assert.equal(entries[0]?.metadata?.message_id, 'a1');
    assert.equal(entries[0]?.metadata?.user_message_id, 'u1');
});

test('chunkText hard-cuts oversized fragments and keeps overlap within the cap', () => {
    for (const source of ['x'.repeat(1300) + '\nend', ('abcdef\n\n').repeat(100), '无分隔符'.repeat(300)]) {
        const chunks = ingestModule.chunkText(source, { maxChunkSize: 100, overlapSize: 20, separators: ['\n\n', '\n'] });
        assert.ok(chunks.length > 1);
        assert.ok(chunks.every(chunk => chunk.length <= 100));
        for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i]?.slice(0, 20), chunks[i - 1]?.slice(-20));
        assert.equal(chunks.reduce((text, chunk, i) => text + (i ? chunk.slice(20) : chunk), ''), source, 'no content is lost at boundaries');
    }
    assert.throws(() => ingestModule.chunkText('long input', { maxChunkSize: 5, overlapSize: 5, separators: [] }), RangeError);
});

test('ingestRecordAsService stores canonical ming_record source type', async () => {
    const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };
    const scoped = createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                assert.equal(table, 'ming_records');
                const query = {
                    select() { return query; },
                    where() { return query; },
                    async executeTakeFirst() {
                        return {
                            id: 'record-1',
                            user_id: 'user-1',
                            title: '记录标题',
                            content: '记录内容',
                            tags: ['tag-1'],
                            category: 'general',
                        };
                    },
                };
                return query;
            },
        } as never),
        rpc: async (name, args) => {
            capture.rpcCall = { fn: name, args };
            return 1;
        },
    });
    const result = await ingestModule.ingestRecordAsService('kb-1', 'record-1', 'user-1', scoped);
    assert.equal(result.chunks > 0, true);
    assert.equal(capture.rpcCall?.fn, 'kb_replace_source_entries');
    assert.equal(capture.rpcCall?.args.p_source_type, 'ming_record');
    assert.equal(capture.rpcCall?.args.p_source_id, 'record-1');
});

test('knowledge-base ingest route normalizes legacy record source type to ming_record flow', async (t) => {
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const featureGateModule = require('../lib/feature-gate-utils') as typeof import('../lib/feature-gate-utils');
    const ingestImpl = require('../lib/knowledge-base/ingest') as typeof import('../lib/knowledge-base/ingest');
    const routePath = require.resolve('../app/api/knowledge-base/ingest/route');

    let recordCalls = 0;
    let genericCalls = 0;
    const scoped = createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                assert.equal(table, 'knowledge_bases');
                const query = {
                    select() { return query; },
                    where() { return query; },
                    async executeTakeFirst() { return { id: 'kb-1', user_id: 'user-1' }; },
                };
                return query;
            },
        } as never),
    });

    t.mock.method(apiUtils, 'requireUserContext', async () => ({
        user: { id: 'user-1' },
        db: scoped,
    }));
    t.mock.method(featureGateModule, 'ensureFeatureRouteEnabled', async () => null);
    t.mock.method(ingestImpl, 'ingestRecordAsService', async () => {
        recordCalls += 1;
        return { entriesCreated: 1, chunks: 1 };
    });
    t.mock.method(ingestImpl, 'ingestDataSourceAsService', async () => {
        genericCalls += 1;
        return { entriesCreated: 0, chunks: 0 };
    });
    t.mock.method(ingestImpl, 'backfillVectorsAsService', async () => ({ entriesCreated: 0, chunks: 0 }));
    delete require.cache[routePath];

    const { POST } = await import('../app/api/knowledge-base/ingest/route');
    const response = await POST(new Request('http://localhost/api/knowledge-base/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            kbId: 'kb-1',
            sourceType: 'record',
            sourceId: 'record-1',
        }),
    }) as never);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(recordCalls, 1);
    assert.equal(genericCalls, 0);
});
