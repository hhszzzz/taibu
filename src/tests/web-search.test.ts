import { beforeEach, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { searchChatWeb, searchWeb, WEB_SEARCH_QUERY_MAX, webSearchConfigured } from '../lib/ai/web-search.server';
import { chatWebSearchAccess, chatWebSearchDenial } from '../lib/ai/web-search-access';

const previousKey = process.env.TAVILY_API_KEY;
beforeEach(t => {
    assert.ok('mock' in t);
    process.env.TAVILY_API_KEY = randomUUID();
    t.after(() => {
        if (previousKey === undefined) delete process.env.TAVILY_API_KEY;
        else process.env.TAVILY_API_KEY = previousKey;
    });
});

function tavily(t: TestContext, respond: (body: { query: string }) => Response | Promise<Response>) {
    const queries: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
        assert.equal(input, 'https://api.tavily.com/search');
        const body = JSON.parse(String(init?.body)) as { query: string };
        queries.push(body.query);
        return respond(body);
    });
    return queries;
}

test('Tavily transport sends only search fields and returns usable sources', async t => {
    t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
        assert.equal(input, 'https://api.tavily.com/search');
        assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${process.env.TAVILY_API_KEY}`);
        assert.deepEqual(JSON.parse(String(init?.body)), { query: '公开信息', search_depth: 'basic', max_results: 5, include_answer: false, include_raw_content: false });
        assert.ok(init?.signal);
        return Response.json({ results: [
            { title: '可引用', url: 'https://example.com', content: '摘要' },
            { title: '不可引用', url: 'javascript:alert(1)', content: '资料' },
            { title: '无效', url: 'not a url', content: '资料' },
            { title: null, url: 'https://example.com/untitled', content: '资料' },
            'not a result',
        ] });
    });
    assert.deepEqual(await searchWeb('公开信息'), [{ title: '可引用', url: 'https://example.com', content: '摘要' }]);
});

test('an unexpected Tavily payload yields no results instead of a crash', async t => {
    tavily(t, () => Response.json({ results: { title: '不是数组' } }));
    assert.deepEqual(await searchWeb('公开信息'), []);
});

test('chat search sends the question collapsed and cut to the length Tavily accepts', async t => {
    const queries = tavily(t, () => Response.json({ results: [] }));
    const question = `  甲辰年\n\n  运势 ${'😀'.repeat(WEB_SEARCH_QUERY_MAX)}`;
    const result = await searchChatWeb(question);
    assert.equal(result.status, 'ok');
    assert.equal(Array.from(queries[0]).length, WEB_SEARCH_QUERY_MAX, 'cut by characters, never inside one');
    assert.ok(queries[0].startsWith('甲辰年 运势 😀'));
    assert.deepEqual(await searchChatWeb(' \n '), { status: 'ok', query: '', results: [] });
    assert.equal(queries.length, 1, 'an empty question is not sent');
});

test('chat search never fails the answer: it reports an unconfigured or failing search instead', async t => {
    const warn = t.mock.method(console, 'warn', () => undefined);
    tavily(t, () => new Response('quota', { status: 432 }));
    assert.deepEqual(await searchChatWeb('甲辰'), { status: 'failed', query: '甲辰' });
    assert.equal(warn.mock.callCount(), 1);
    delete process.env.TAVILY_API_KEY;
    assert.equal(webSearchConfigured(), false);
    assert.deepEqual(await searchChatWeb('甲辰'), { status: 'unavailable', query: '甲辰' });
});

test('a cancelled chat search rejects instead of answering without results', async t => {
    tavily(t, () => new Promise<Response>((_, reject) => setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 5)));
    const controller = new AbortController();
    const pending = searchChatWeb('甲辰', controller.signal);
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
