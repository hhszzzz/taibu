import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { searchChatWeb } from '../lib/ai/web-search.server';
import { chatWebSearchAccess, chatWebSearchDenial, webSearchTier, webSearchUnavailableTitle } from '../lib/ai/web-search-access';
import { WEB_SEARCH_QUERY_MAX } from '../lib/agent/mcp/web-results';
import type { MembershipType } from '../lib/user/membership';

const route = require('../lib/agent/mcp/web-route.server') as typeof import('../lib/agent/mcp/web-route.server');

let searches: Array<{ query: string; membership: MembershipType }> = [];
beforeEach((t) => {
    assert.ok('mock' in t);
    searches = [];
    t.mock.method(route, 'webRouteAvailable', async (kind: string, membership: MembershipType) => kind === 'search' && membership !== 'free');
    t.mock.method(route, 'searchWeb', async (query: string, options: { membership: MembershipType }) => {
        searches.push({ query, membership: options.membership });
        return [{ title: '来源', url: 'https://example.com/', content: '摘要' }];
    });
});

test('chat search sends the question collapsed and cut by characters, routed for the member\'s tier', async () => {
    const question = `  甲辰年\n\n  运势 ${'😀'.repeat(WEB_SEARCH_QUERY_MAX)}`;
    const result = await searchChatWeb(question, 'pro');
    assert.equal(result.status, 'ok');
    assert.equal(Array.from(searches[0].query).length, WEB_SEARCH_QUERY_MAX, 'cut by characters, never inside one');
    assert.ok(searches[0].query.startsWith('甲辰年 运势 😀'));
    assert.equal(searches[0].membership, 'pro');
    assert.deepEqual(await searchChatWeb(' \n ', 'plus'), { status: 'ok', query: '', results: [] });
    assert.equal(searches.length, 1, 'an empty question is not sent');
});

test('chat search never fails the answer: no service for the tier, or a failing one, is reported instead', async (t) => {
    assert.deepEqual(await searchChatWeb('甲辰', 'free'), { status: 'unavailable', query: '甲辰' });
    const warn = t.mock.method(console, 'warn', () => undefined);
    t.mock.method(route, 'searchWeb', async () => { throw new Error('联网搜索失败：外部服务响应超时'); });
    assert.deepEqual(await searchChatWeb('甲辰', 'plus'), { status: 'failed', query: '甲辰' });
    assert.equal(warn.mock.callCount(), 1);
    assert.doesNotMatch(JSON.stringify(warn.mock.calls[0].arguments), /超时/u, 'the log names no upstream detail');
});

test('a cancelled chat search rejects instead of answering without results', async (t) => {
    const controller = new AbortController();
    t.mock.method(route, 'searchWeb', async (_query: string, options: { signal?: AbortSignal }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        options.signal?.throwIfAborted();
        return [];
    });
    const pending = searchChatWeb('甲辰', 'plus', controller.signal);
    controller.abort(new Error('client left'));
    await assert.rejects(pending, /client left/u);
});

test('Plus may search, only Pro may search alongside a document, and free accounts may not search', () => {
    assert.deepEqual(chatWebSearchAccess('free'), { search: false, withDocument: false });
    assert.deepEqual(chatWebSearchAccess('plus'), { search: true, withDocument: false });
    assert.deepEqual(chatWebSearchAccess('pro'), { search: true, withDocument: true });
    assert.equal(chatWebSearchDenial('free', false), '免费用户无法使用网络搜索功能，请升级会员');
    assert.equal(chatWebSearchDenial('plus', true), 'Plus 会员无法同时使用文件和搜索，请升级 Pro 会员');
    assert.equal(chatWebSearchDenial('plus', false), null);
    assert.equal(chatWebSearchDenial('pro', true), null);
});

test('the web toggle names the plan a search service serves, never below Plus, or says none is set up', () => {
    assert.deepEqual([webSearchTier(null), webSearchTier('free'), webSearchTier('plus'), webSearchTier('pro')], [null, 'plus', 'plus', 'pro']);
    assert.equal(webSearchUnavailableTitle('pro'), '联网搜索需要 Pro 会员');
    assert.equal(webSearchUnavailableTitle(null), '当前环境未配置联网搜索');
});
