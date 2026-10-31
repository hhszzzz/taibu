import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { searchChatWeb } from '../lib/ai/web-search.server';
import { WEB_SEARCH_QUERY_MAX } from '../lib/agent/mcp/web-results';

const route = require('../lib/agent/mcp/web-route.server') as typeof import('../lib/agent/mcp/web-route.server');

let searches: string[] = [];
let available = true;
beforeEach((t) => {
    assert.ok('mock' in t);
    searches = [];
    available = true;
    t.mock.method(route, 'webRouteAvailable', async (kind: string) => kind === 'search' && available);
    t.mock.method(route, 'searchWeb', async (query: string) => {
        searches.push(query);
        return [{ title: '来源', url: 'https://example.com/', content: '摘要' }];
    });
});

test('chat search sends the question collapsed and cut by characters, for every member', async () => {
    const question = `  甲辰年\n\n  运势 ${'😀'.repeat(WEB_SEARCH_QUERY_MAX)}`;
    const result = await searchChatWeb(question);
    assert.equal(result.status, 'ok');
    assert.equal(Array.from(searches[0]).length, WEB_SEARCH_QUERY_MAX, 'cut by characters, never inside one');
    assert.ok(searches[0].startsWith('甲辰年 运势 😀'));
    assert.deepEqual(await searchChatWeb(' \n '), { status: 'ok', query: '', results: [] });
    assert.equal(searches.length, 1, 'an empty question is not sent');
});

test('chat search never fails the answer: no service set up, or a failing one, is reported instead', async (t) => {
    available = false;
    assert.deepEqual(await searchChatWeb('甲辰'), { status: 'unavailable', query: '甲辰' });
    available = true;
    const warn = t.mock.method(console, 'warn', () => undefined);
    t.mock.method(route, 'searchWeb', async () => { throw new Error('联网搜索失败：外部服务响应超时'); });
    assert.deepEqual(await searchChatWeb('甲辰'), { status: 'failed', query: '甲辰' });
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
    const pending = searchChatWeb('甲辰', controller.signal);
    controller.abort(new Error('client left'));
    await assert.rejects(pending, /client left/u);
});
