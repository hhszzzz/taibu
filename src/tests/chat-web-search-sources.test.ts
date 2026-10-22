import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebSearchSources } from '../components/chat/WebSearchSources';
import { getVisibleWebSearch } from '../lib/chat/feature-normalization';

test('only http(s) pages are shown, once each, with a bounded title or their host', () => {
    const search = getVisibleWebSearch({ webSearch: { status: 'ok', sources: [
        { title: '  黄历\n说明  ', url: 'https://example.com/almanac' },
        { title: '重复', url: 'https://example.com/almanac' },
        { title: '脚本', url: 'javascript:alert(1)' },
        { title: '数据', url: 'data:text/html,<b>x</b>' },
        { title: '站内', url: '/records' },
        { title: '', url: 'http://example.org/x' },
        { title: '长'.repeat(400), url: 'https://example.net/' },
    ] } });
    assert.deepEqual(search?.sources.map(({ title, url, host }) => [title.length > 20 ? title.length : title, url, host]), [
        ['黄历 说明', 'https://example.com/almanac', 'example.com'],
        ['example.org', 'http://example.org/x', 'example.org'],
        [300, 'https://example.net/', 'example.net'],
    ]);
});

test('metadata the browser saved in another shape shows no web search', () => {
    for (const webSearch of [undefined, null, 'ok', [], { status: 'done', sources: [] }, { sources: [] }]) {
        assert.equal(getVisibleWebSearch({ webSearch } as never), null, JSON.stringify(webSearch));
    }
    assert.deepEqual(getVisibleWebSearch({ webSearch: { status: 'failed', sources: 'none' } } as never), { status: 'failed', sources: [] });
    assert.deepEqual(getVisibleWebSearch({ webSearch: { status: 'ok', sources: [null, 3, { url: 42 }] } } as never), { status: 'ok', sources: [] });
});

test('an answer says when its web search did not run or found nothing, and folds the pages it used', () => {
    const render = (search: Parameters<typeof WebSearchSources>[0]['search']) => renderToStaticMarkup(createElement(WebSearchSources, { search }));
    assert.match(render({ status: 'failed', sources: [] }), /联网搜索未能完成，本次回答没有参考网页/u);
    assert.match(render({ status: 'unavailable', sources: [] }), /联网搜索暂不可用，本次回答没有参考网页/u);
    assert.match(render({ status: 'ok', sources: [] }), /联网搜索没有找到可参考的网页/u);
    const folded = render({ status: 'ok', sources: [{ title: '黄历说明', url: 'https://example.com/almanac', host: 'example.com' }] });
    assert.match(folded, /联网搜索参考了 1 个网页/u);
    assert.match(folded, /aria-expanded="false"/u);
    assert.doesNotMatch(folded, /<a /u, 'pages are listed once the reader unfolds them');
});
