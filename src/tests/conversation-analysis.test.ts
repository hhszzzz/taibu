import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../types';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

const loadModule = () => require('../lib/ai/ai-analysis-query') as typeof import('../lib/ai/ai-analysis-query');

test('extractAnalysisFromConversation prefers message metadata then source_data', () => {
    const { extractAnalysisFromConversation } = loadModule();
    const messages: ChatMessage[] = [
        {
            id: '1',
            role: 'assistant',
            content: 'analysis',
            createdAt: '2024-01-01',
            model: 'deepseek-v3.2',
            reasoning: 'think',
        },
    ];
    const sourceData = { model_id: 'glm-4', reasoning_text: 'fallback' };
    const result = extractAnalysisFromConversation(messages, sourceData);
    assert.equal(result.analysis, 'analysis');
    assert.equal(result.modelId, 'deepseek-v3.2');
    assert.equal(result.reasoning, 'think');
});

test('extractAnalysisFromConversation falls back to source_data when message missing', () => {
    const { extractAnalysisFromConversation } = loadModule();
    const messages: ChatMessage[] = [
        {
            id: '1',
            role: 'assistant',
            content: 'analysis',
            createdAt: '2024-01-01',
        },
    ];
    const sourceData = { model_id: 'glm-4', reasoning_text: 'fallback' };
    const result = extractAnalysisFromConversation(messages, sourceData);
    assert.equal(result.modelId, 'glm-4');
    assert.equal(result.reasoning, 'fallback');
});

test('hydrateConversationMessages backfills model/reasoning when missing', () => {
    const { hydrateConversationMessages } = loadModule();
    const messages: ChatMessage[] = [
        {
            id: '1',
            role: 'assistant',
            content: 'analysis',
            createdAt: '2024-01-01',
        },
    ];
    const sourceData = { model_id: 'glm-4', reasoning_text: 'fallback' };
    const result = hydrateConversationMessages(messages, sourceData);
    assert.equal(result[0].model, 'glm-4');
    assert.equal(result[0].reasoning, 'fallback');
});

test('createAIAnalysisConversation stores model/reasoning in assistant message', async (t) => {
    const supabaseServerPath = require.resolve('../lib/supabase-server');
    const aiAnalysisPath = require.resolve('../lib/ai/ai-analysis');
    const supabaseServerModule = require('../lib/supabase-server');
    const originalGetServiceClient = supabaseServerModule.getSystemAdminClient;
    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

    supabaseServerModule.getSystemAdminClient = () => ({
        rpc: async (fn: string, args: Record<string, unknown>) => {
            rpcCalls.push({ fn, args });
            return { data: 'conv-1', error: null };
        },
    });

    t.after(() => {
        supabaseServerModule.getSystemAdminClient = originalGetServiceClient;
        delete require.cache[aiAnalysisPath];
        delete require.cache[supabaseServerPath];
    });

    delete require.cache[aiAnalysisPath];
    const { createAIAnalysisConversation } = require('../lib/ai/ai-analysis') as typeof import('../lib/ai/ai-analysis');

    const conversationId = await createAIAnalysisConversation({
        userId: 'user-1',
        sourceType: 'tarot',
        sourceData: {
            model_id: 'glm-4',
            reasoning_text: 'fallback',
        },
        title: 'Test',
        aiResponse: 'analysis',
    });

    assert.equal(conversationId, 'conv-1');
    assert.equal(rpcCalls.length, 1);
    const [rpcCall] = rpcCalls;
    assert.ok(rpcCall);
    assert.equal(rpcCall.fn, 'create_conversation_with_messages');
    assert.equal(rpcCall.args.p_user_id, 'user-1');
    assert.equal(rpcCall.args.p_source_type, 'tarot');
    assert.equal(rpcCall.args.p_title, 'Test');
    const rpcMessages = (rpcCall.args.p_messages as ChatMessage[]) || [];
    assert.equal(rpcMessages[0]?.model, 'glm-4');
    assert.equal(rpcMessages[0]?.reasoning, 'fallback');
});

test('createAIAnalysisConversation should use transactional history rpc when history binding is provided', async (t) => {
    const apiUtilsPath = require.resolve('../lib/api-utils');
    const aiAnalysisPath = require.resolve('../lib/ai/ai-analysis');
    const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const originalGetServiceClient = apiUtilsModule.getSystemAdminClient;
    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

    apiUtilsModule.getSystemAdminClient = () => ({
        rpc: async (fn: string, args: Record<string, unknown>) => {
            rpcCalls.push({ fn, args });
            return { data: 'conv-2', error: null };
        },
    } as unknown as ReturnType<typeof apiUtilsModule.getSystemAdminClient>);

    t.after(() => {
        apiUtilsModule.getSystemAdminClient = originalGetServiceClient;
        delete require.cache[aiAnalysisPath];
        delete require.cache[apiUtilsPath];
    });

    delete require.cache[aiAnalysisPath];
    const { createAIAnalysisConversation } = require('../lib/ai/ai-analysis') as typeof import('../lib/ai/ai-analysis');
    const conversationId = await createAIAnalysisConversation({
        userId: 'user-1',
        sourceType: 'mbti',
        sourceData: {
            model_id: 'glm-4',
            reasoning_text: 'fallback',
        },
        title: 'Test',
        aiResponse: 'analysis',
        historyBinding: {
            type: 'mbti',
            payload: {
                reading_id: 'reading-1',
            },
        },
    });

    assert.equal(conversationId, 'conv-2');
    assert.equal(rpcCalls.length, 1);
    const [rpcCall] = rpcCalls;
    assert.ok(rpcCall);
    assert.equal(rpcCall.fn, 'create_analysis_conversation_with_history_as_service');
    assert.equal(rpcCall.args.p_history_type, 'mbti');
    const rpcMessages = (rpcCall.args.p_messages as ChatMessage[]) || [];
    assert.equal(rpcMessages[0]?.content, 'analysis');
    assert.equal(rpcMessages[0]?.model, 'glm-4');
    assert.equal((rpcCall.args.p_history_payload as Record<string, unknown>)?.reading_id, 'reading-1');
});

test('replaceConversationMessages should return an infra error when rpc is unavailable', async () => {
    const { replaceConversationMessages } = require('../lib/server/conversation-messages') as typeof import('../lib/server/conversation-messages');
    const result = await replaceConversationMessages({} as never, 'conv-1', [
        {
            id: 'm-1',
            role: 'assistant',
            content: 'analysis',
            createdAt: '2024-01-01T00:00:00.000Z',
        },
    ]);

    assert.equal(result.error?.message, 'replace_conversation_messages RPC unavailable');
});

test('loadConversationAnalysisSnapshot reads lightweight snapshot payload', async (t) => {
    const originalFetch = global.fetch;
    const analysisModulePath = require.resolve('../lib/chat/conversation-analysis');

    global.fetch = (async (input: RequestInfo | URL) => {
        assert.equal(String(input), '/api/conversations/conv-1?snapshot=analysis');
        return new Response(JSON.stringify({
            snapshot: {
                analysis: 'saved analysis',
                reasoning: 'saved reasoning',
                modelId: 'glm-4',
                reasoningEnabled: true,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }) as typeof global.fetch;

    t.after(() => {
        global.fetch = originalFetch;
        delete require.cache[analysisModulePath];
    });

    delete require.cache[analysisModulePath];
    const { loadConversationAnalysisSnapshot } = require('../lib/chat/conversation-analysis') as typeof import('../lib/chat/conversation-analysis');
    const snapshot = await loadConversationAnalysisSnapshot('conv-1');

    assert.deepEqual(snapshot, {
        analysis: 'saved analysis',
        reasoning: 'saved reasoning',
        modelId: 'glm-4',
        reasoningEnabled: true,
    });
});

test('loadConversationAnalysisSnapshot should throw on non-404 failures', async (t) => {
    const originalFetch = global.fetch;
    const analysisModulePath = require.resolve('../lib/chat/conversation-analysis');

    global.fetch = (async () => new Response(JSON.stringify({
        error: '认证失败',
    }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
    })) as typeof global.fetch;

    t.after(() => {
        global.fetch = originalFetch;
        delete require.cache[analysisModulePath];
    });

    delete require.cache[analysisModulePath];
    const { loadConversationAnalysisSnapshot } = require('../lib/chat/conversation-analysis') as typeof import('../lib/chat/conversation-analysis');

    await assert.rejects(
        () => loadConversationAnalysisSnapshot('conv-1'),
        /认证失败/u,
    );
});

test('loadLatestConversationAnalysisSnapshot should include chartId filter when provided', async (t) => {
    const originalFetch = global.fetch;
    const analysisModulePath = require.resolve('../lib/chat/conversation-analysis');
    const requests: string[] = [];

    global.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url === '/api/conversations?includeArchived=true&limit=1&sourceType=bazi_wuxing&chartId=chart-1') {
            return new Response(JSON.stringify({
                conversations: [{ id: 'conv-1' }],
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (url === '/api/conversations/conv-1?snapshot=analysis') {
            return new Response(JSON.stringify({
                snapshot: {
                    analysis: 'saved analysis',
                    reasoning: null,
                    modelId: 'glm-4',
                    reasoningEnabled: false,
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response('not found', { status: 404 });
    }) as typeof global.fetch;

    t.after(() => {
        global.fetch = originalFetch;
        delete require.cache[analysisModulePath];
    });

    delete require.cache[analysisModulePath];
    const { loadLatestConversationAnalysisSnapshot } = require('../lib/chat/conversation-analysis') as typeof import('../lib/chat/conversation-analysis');
    const snapshot = await loadLatestConversationAnalysisSnapshot({
        sourceType: 'bazi_wuxing',
        chartId: 'chart-1',
    });

    assert.equal(snapshot?.analysis, 'saved analysis');
    assert.deepEqual(requests, [
        '/api/conversations?includeArchived=true&limit=1&sourceType=bazi_wuxing&chartId=chart-1',
        '/api/conversations/conv-1?snapshot=analysis',
    ]);
});
