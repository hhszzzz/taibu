import { test } from 'node:test';
import assert from 'node:assert/strict';

const ingestModule = require('../lib/knowledge-base/ingest') as any;
const apiUtilsModule = require('../lib/api-utils') as any;

test('ingestChatMessageAsService stores chat_message entries with metadata', async () => {
    const originalGetServiceClient = apiUtilsModule.getSystemAdminClient;
    const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };

    apiUtilsModule.getSystemAdminClient = () => ({
        rpc: (fn: string, args: Record<string, unknown>) => {
            capture.rpcCall = { fn, args };
            return Promise.resolve({ data: 1, error: null });
        },
        from: (table: string) => {
            if (table === 'conversations') {
                return {
                    select: () => ({
                        eq: () => ({
                            eq: () => ({
                                maybeSingle: async () => ({
                                    data: {
                                        id: 'conv-1',
                                        user_id: 'user-1',
                                    },
                                    error: null
                                })
                            })
                        })
                    })
                };
            }
            if (table === 'conversation_messages') {
                return {
                    select: () => ({
                        eq(column: string) {
                            if (column === 'conversation_id') {
                                return {
                                    eq(innerColumn: string) {
                                        if (innerColumn === 'message_id') {
                                            return {
                                                maybeSingle: async () => ({
                                                    data: {
                                                        sequence: 2,
                                                        message_id: 'a1',
                                                        role: 'assistant',
                                                        content: '你好，我在',
                                                        metadata: null,
                                                        created_at: '2026-03-27T00:00:00.000Z',
                                                    },
                                                    error: null,
                                                }),
                                            };
                                        }
                                        if (innerColumn === 'role') {
                                            return {
                                                lt: () => ({
                                                    order: () => ({
                                                        limit: () => ({
                                                            maybeSingle: async () => ({
                                                                data: {
                                                                    sequence: 1,
                                                                    message_id: 'u1',
                                                                    role: 'user',
                                                                    content: '你好',
                                                                    metadata: null,
                                                                    created_at: '2026-03-27T00:00:00.000Z',
                                                                },
                                                                error: null,
                                                            }),
                                                        }),
                                                    }),
                                                }),
                                            };
                                        }
                                        throw new Error(`Unexpected conversation_messages eq: ${innerColumn}`);
                                    },
                                };
                            }
                            throw new Error(`Unexpected conversation_messages select eq: ${column}`);
                        },
                    }),
                };
            }
            return {};
        }
    });

    try {
        const result = await ingestModule.ingestChatMessageAsService('kb-1', 'conv-1', 'a1', 'user-1');
        assert.equal(result.chunks > 0, true);
        assert.equal(capture.rpcCall?.fn, 'kb_replace_source_entries');
        assert.equal(capture.rpcCall?.args.p_source_type, 'chat_message');
        assert.equal(capture.rpcCall?.args.p_source_id, 'a1');
        assert.equal(capture.rpcCall?.args.p_archive, true);
        const entries = (capture.rpcCall?.args.p_entries as Array<{ metadata: Record<string, unknown> }>) || [];
        assert.equal(entries[0]?.metadata?.conversation_id, 'conv-1');
        assert.equal(entries[0]?.metadata?.message_id, 'a1');
        assert.equal(entries[0]?.metadata?.user_message_id, 'u1');
    } finally {
        apiUtilsModule.getSystemAdminClient = originalGetServiceClient;
    }
});

test('ingestRecordAsService stores canonical ming_record source type', async () => {
    const originalGetServiceClient = apiUtilsModule.getSystemAdminClient;
    const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };

    apiUtilsModule.getSystemAdminClient = () => ({
        rpc: (fn: string, args: Record<string, unknown>) => {
            capture.rpcCall = { fn, args };
            return Promise.resolve({ data: 1, error: null });
        },
        from: (table: string) => {
            if (table === 'ming_records') {
                return {
                    select: () => ({
                        eq: () => ({
                            eq: () => ({
                                maybeSingle: async () => ({
                                    data: {
                                        id: 'record-1',
                                        user_id: 'user-1',
                                        title: '记录标题',
                                        content: '记录内容',
                                        tags: ['tag-1'],
                                        category: 'general',
                                    },
                                    error: null,
                                }),
                            }),
                        }),
                    }),
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        },
    });

    try {
        const result = await ingestModule.ingestRecordAsService('kb-1', 'record-1', 'user-1');
        assert.equal(result.chunks > 0, true);
        assert.equal(capture.rpcCall?.fn, 'kb_replace_source_entries');
        assert.equal(capture.rpcCall?.args.p_source_type, 'ming_record');
        assert.equal(capture.rpcCall?.args.p_source_id, 'record-1');
    } finally {
        apiUtilsModule.getSystemAdminClient = originalGetServiceClient;
    }
});

test('knowledge-base ingest route normalizes legacy record source type to ming_record flow', async (t) => {
    const apiUtils = require('../lib/api-utils') as any;
    const membershipModule = require('../lib/user/membership-server') as any;
    const featureGateModule = require('../lib/feature-gate-utils') as any;
    const ingestImpl = require('../lib/knowledge-base/ingest') as any;
    const routePath = require.resolve('../app/api/knowledge-base/ingest/route');
    const originalRequireUserContext = apiUtils.requireUserContext;
    const originalGetEffectiveMembershipType = membershipModule.getEffectiveMembershipType;
    const originalEnsureFeatureRouteEnabled = featureGateModule.ensureFeatureRouteEnabled;
    const originalIngestRecordAsService = ingestImpl.ingestRecordAsService;
    const originalIngestDataSourceAsService = ingestImpl.ingestDataSourceAsService;
    const originalBackfillVectorsAsService = ingestImpl.backfillVectorsAsService;

    let recordCalls = 0;
    let genericCalls = 0;

    apiUtils.requireUserContext = async () => ({
        user: { id: 'user-1' },
        supabase: {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({
                                data: { id: 'kb-1', user_id: 'user-1' },
                                error: null,
                            }),
                        }),
                    }),
                }),
            }),
        },
    });
    membershipModule.getEffectiveMembershipType = async () => 'plus';
    featureGateModule.ensureFeatureRouteEnabled = async () => null;
    ingestImpl.ingestRecordAsService = async () => {
        recordCalls += 1;
        return { entriesCreated: 1, chunks: 1 };
    };
    ingestImpl.ingestDataSourceAsService = async () => {
        genericCalls += 1;
        return { entriesCreated: 0, chunks: 0 };
    };
    ingestImpl.backfillVectorsAsService = async () => ({ entriesCreated: 0, chunks: 0 });
    delete require.cache[routePath];

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
        membershipModule.getEffectiveMembershipType = originalGetEffectiveMembershipType;
        featureGateModule.ensureFeatureRouteEnabled = originalEnsureFeatureRouteEnabled;
        ingestImpl.ingestRecordAsService = originalIngestRecordAsService;
        ingestImpl.ingestDataSourceAsService = originalIngestDataSourceAsService;
        ingestImpl.backfillVectorsAsService = originalBackfillVectorsAsService;
        delete require.cache[routePath];
    });

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
