import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import SharedConversationPage, { dynamic, generateMetadata } from '../app/share/[token]/page';

const TOKEN = 'T'.repeat(43);

function anonRpc(t: TestContext, rows: unknown[] | null, error: unknown = null) {
    const calls: { name: string; args: unknown }[] = [];
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    t.mock.method(api, 'createAnonClient', () => ({
        rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: rows, error }; },
    }) as unknown as ReturnType<typeof api.createAnonClient>);
    return calls;
}

const params = (token: string) => ({ params: Promise.resolve({ token }) });

async function assertNotFound(promise: Promise<unknown>) {
    await assert.rejects(promise, (error: { digest?: string }) => String(error?.digest ?? '').startsWith('NEXT_HTTP_ERROR_FALLBACK;404'));
}

test('the share page is dynamic, unindexed and never leaks its URL as a referrer', async t => {
    anonRpc(t, []);
    assert.equal(dynamic, 'force-dynamic');
    const metadata = await generateMetadata(params(TOKEN));
    assert.deepEqual(metadata.robots, { index: false, follow: false });
    assert.equal(metadata.referrer, 'no-referrer');
});

test('malformed tokens are rejected before any database lookup', async t => {
    const calls = anonRpc(t, []);
    for (const token of ['short', `${TOKEN}x`, `${'T'.repeat(42)}!`]) await assertNotFound(SharedConversationPage(params(token)));
    assert.equal(calls.length, 0);
});

test('unknown and revoked links render the same 404', async t => {
    const calls = anonRpc(t, []);
    await assertNotFound(SharedConversationPage(params('U'.repeat(43))));
    assert.deepEqual(calls, [{ name: 'get_conversation_share', args: { p_token: 'U'.repeat(43) } }]);
});

test('database failures surface as errors instead of a misleading 404', async t => {
    anonRpc(t, null, { message: 'down' });
    await assert.rejects(SharedConversationPage(params('E'.repeat(43))), /读取分享失败/);
});

test('an active link renders the read-only snapshot without any controls', async t => {
    anonRpc(t, [{
        title: '流年咨询',
        snapshot: [
            { role: 'user', content: '今年运势如何？', attachments: ['资料.txt'], mentionTypes: ['bazi_chart'] },
            { role: 'assistant', content: '**整体平稳**', sources: [{ title: '公开资料', url: 'https://example.com/a' }], basis: [{ title: '排八字', text: '年柱 庚午' }] },
            { role: 'system', content: '不应出现的系统提示' },
        ],
        include_charts: true,
        created_at: '2026-10-19T08:00:00Z',
        updated_at: '2026-10-19T08:05:00Z',
    }]);
    const element = await SharedConversationPage(params('V'.repeat(43))) as ReactElement;
    const html = renderToStaticMarkup(element);
    for (const text of ['太卜 · 分享的对话', '流年咨询', '今年运势如何？', '资料.txt', '八字命盘', '整体平稳', '公开资料', '排八字 · 命盘依据', '分享于 2026年10月19日']) assert.ok(html.includes(text), text);
    assert.equal(html.includes('不应出现的系统提示'), false);
    assert.match(html, /rel="noopener noreferrer nofollow"/);
    assert.doesNotMatch(html, /<textarea|<form|contenteditable/);
});
