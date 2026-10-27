import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../types';
import type { AgentMessageData } from '../lib/agent/types';
import {
    buildShareSnapshot,
    createShareToken,
    isShareToken,
    normalizeShareTitle,
    parseSharedSnapshot,
    sharePath,
    shareStateFromRow,
    SHARE_SNAPSHOT_MAX_BYTES,
    ShareSnapshotTooLargeError,
} from '../lib/chat/conversation-share';

const agent: AgentMessageData = {
    version: 1,
    runId: 'run-private',
    status: 'completed',
    parts: [
        { id: 'r', type: 'reasoning', text: '内部推理' },
        { id: 't1', type: 'tool', name: 'bazi_calculate', title: '排八字', status: 'completed', input: { birth: '1990-01-01', apiKey: 'sk-secret' }, output: { raw: 'private-output' }, canonicalText: '年柱 庚午' },
        { id: 's1', type: 'source', title: '公开资料', url: 'https://example.com/a', content: '来源全文' },
        { id: 's2', type: 'source', title: '本地脚本', url: 'javascript:alert(1)' },
        { id: 'q', type: 'question', questionId: 'q1', question: '补充出生时间？', options: [], status: 'answered' },
        { id: 'x', type: 'text', text: '最终回答' },
    ],
} as unknown as AgentMessageData;

const history: ChatMessage[] = [
    { id: 'sys', role: 'system', content: '系统提示词', createdAt: '2026-10-19T00:00:00.000Z' },
    {
        id: 'u1', role: 'user', content: '帮我看看这个盘', createdAt: '2026-10-19T00:00:01.000Z',
        mentions: [{ type: 'bazi_chart', id: 'chart-private-id', name: '张三', preview: '1990-01-01 子时' }],
        attachments: { ids: ['attachment-private-id'], fileName: '资料.txt' },
        chartInfo: { baziName: '张三' },
    },
    {
        id: 'a1', role: 'assistant', content: '最终回答', createdAt: '2026-10-19T00:00:02.000Z', model: 'private-model-key', modelName: '太卜演示',
        reasoning: '思考过程', metadata: { sources: [{ type: 'mention', name: '张三' }], promptDiagnostics: { prompt: '系统提示词' } },
        versions: [{ userContent: '旧问题', aiContent: '旧版本', createdAt: '2026-10-18T00:00:00.000Z' }], currentVersionIndex: 1,
        agent,
    } as ChatMessage,
];

test('share tokens are 43-character base64url values and validation rejects anything else', () => {
    const first = createShareToken();
    const second = createShareToken();
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first, second);
    assert.equal(isShareToken(first), true);
    for (const value of ['', 'short', `${first}x`, `${first.slice(0, 42)}!`, null, 42]) assert.equal(isShareToken(value), false);
    assert.equal(sharePath(first), `/share/${first}`);
    assert.deepEqual(shareStateFromRow({ token: first, include_charts: true, created_at: 'c', updated_at: 'u' }), { token: first, path: `/share/${first}`, includeCharts: true, createdAt: 'c', updatedAt: 'u' });
});

test('snapshot keeps the visible branch only and strips ids, names, versions and runtime state', () => {
    const snapshot = buildShareSnapshot(history, { includeCharts: false });
    assert.deepEqual(snapshot, [
        { role: 'user', content: '帮我看看这个盘', createdAt: '2026-10-19T00:00:01.000Z', attachments: ['资料.txt'], mentionTypes: ['bazi_chart'] },
        { role: 'assistant', content: '最终回答', createdAt: '2026-10-19T00:00:02.000Z', modelName: '太卜演示', references: 1, sources: [{ title: '公开资料', url: 'https://example.com/a' }] },
    ]);
    const serialized = JSON.stringify(snapshot);
    for (const secret of ['系统提示词', 'chart-private-id', '张三', 'attachment-private-id', 'private-model-key', '思考过程', '旧版本', 'run-private', '内部推理', 'sk-secret', 'private-output', '年柱', '补充出生时间', 'javascript:', '来源全文']) {
        assert.equal(serialized.includes(secret), false, secret);
    }
});

test('chart basis is opt-in and only carries the canonical text, never raw tool input or output', () => {
    const snapshot = buildShareSnapshot(history, { includeCharts: true });
    assert.deepEqual(snapshot[1].basis, [{ title: '排八字', text: '年柱 庚午' }]);
    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes('sk-secret'), false);
    assert.equal(serialized.includes('private-output'), false);
});

test('a plain chat answer shares the pages its web search returned, never a non-web address', () => {
    const answer = {
        id: 'w1', role: 'assistant', content: '参考网页的回答', createdAt: '2026-10-19T00:00:03.000Z',
        metadata: { sources: [], webSearch: { status: 'ok', sources: [
            { title: '黄历说明', url: 'https://example.com/almanac' },
            { title: '重复', url: 'https://example.com/almanac' },
            { title: '脚本', url: 'javascript:alert(1)' },
        ] } },
    } as ChatMessage;
    assert.deepEqual(buildShareSnapshot([answer], { includeCharts: false })[0].sources, [{ title: '黄历说明', url: 'https://example.com/almanac' }]);
});

test('generated images ride along with a share snapshot and are parsed defensively', () => {
    const image = { id: '11111111-1111-4111-8111-111111111111', size: '1024x1024', mimeType: 'image/png' };
    const message: ChatMessage = {
        id: 'a-images', role: 'assistant', content: '已生成 1 张图片。', createdAt: '2026-10-19T00:00:03.000Z',
        metadata: { sources: [], generatedImages: [image] },
    };
    const agentMessage: ChatMessage = {
        id: 'a-tool-images', role: 'assistant', content: '', createdAt: '2026-10-19T00:00:04.000Z',
        agent: { version: 1, runId: 'run', status: 'completed', parts: [{
            id: 'g1', type: 'tool', name: 'generate_image', title: '生成图片', status: 'completed',
            input: { prompt: '水墨山居' }, output: { prompt: '水墨山居', images: [image] },
        }] },
    };
    const snapshot = buildShareSnapshot([message, agentMessage], { includeCharts: false });
    assert.deepEqual(snapshot.map(entry => entry.images), [[image], [image]]);
    assert.deepEqual(parseSharedSnapshot(JSON.parse(JSON.stringify(snapshot))).map(entry => entry.images), [[image], [image]]);
    assert.deepEqual(parseSharedSnapshot([{ role: 'assistant', content: 'x', images: [{ id: 'not-a-uuid', size: '1024x1024', mimeType: 'image/png' }] }]), [
        { role: 'assistant', content: 'x' },
    ], 'an invalid image reference never reaches the renderer');
});

test('empty turns are dropped and oversized snapshots are rejected before reaching the database', () => {
    const empty: ChatMessage = { id: 'e', role: 'assistant', content: '   ', createdAt: '2026-10-19T00:00:00.000Z' };
    assert.deepEqual(buildShareSnapshot([empty], { includeCharts: false }), []);
    const huge: ChatMessage = { id: 'h', role: 'assistant', content: 'x'.repeat(SHARE_SNAPSHOT_MAX_BYTES), createdAt: '2026-10-19T00:00:00.000Z' };
    assert.throws(() => buildShareSnapshot([huge], { includeCharts: false }), ShareSnapshotTooLargeError);
});

test('stored snapshots are parsed defensively before rendering', () => {
    const parsed = parseSharedSnapshot([
        { role: 'user', content: '问题', mentionTypes: ['bazi_chart', 'unknown_kind'], attachments: ['a.txt', 3] },
        { role: 'assistant', content: '回答', sources: [{ title: '外链', url: 'https://example.com' }, { title: '坏链接', url: 'javascript:alert(1)' }], basis: [{ title: '依据', text: '内容' }, { text: '' }], references: -1 },
        { role: 'system', content: '不应出现' },
        { role: 'assistant' },
        'garbage',
    ]);
    assert.deepEqual(parsed, [
        { role: 'user', content: '问题', mentionTypes: ['bazi_chart'], attachments: ['a.txt'] },
        { role: 'assistant', content: '回答', sources: [{ title: '外链', url: 'https://example.com' }], basis: [{ title: '依据', text: '内容' }] },
    ]);
    assert.deepEqual(parseSharedSnapshot(null), []);
    assert.deepEqual(parseSharedSnapshot({ role: 'user' }), []);
});

test('share titles are single-line, non-empty and bounded', () => {
    assert.equal(normalizeShareTitle('  多行\n标题  '), '多行 标题');
    assert.equal(normalizeShareTitle(null), '对话');
    assert.equal(normalizeShareTitle('长'.repeat(300)).length, 200);
});
