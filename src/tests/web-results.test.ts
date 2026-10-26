import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWebPage, parseWebSearchResults } from '../lib/agent/mcp/web-results';

// Text as exa-mcp-server's web_search_exa writes it: notes, then records joined by a rule between empty lines.
const EXA_SEARCH = [
  'Note: Some results were filtered for safety.',
  '',
  [
    'Title: 甲辰年运势解读',
    'URL: https://example.com/jiachen',
    'Published: 2024-02-10T00:00:00.000Z',
    'Author: N/A',
    'Highlights:',
    '甲辰年天干甲木，地支辰土。',
    '',
    '---',
    '',
    '辰为水库。',
  ].join('\n'),
  ['Title: N/A', 'URL: https://example.org/page', 'Published: N/A', 'Author: 张三', 'Text: 全文第一行', '全文第二行'].join('\n'),
  ['Title: 脚本', 'URL: javascript:alert(1)', 'Published: N/A', 'Author: N/A', 'Highlights:', '不可引用'].join('\n'),
  ['Title: 重复', 'URL: https://example.com/jiachen', 'Published: N/A', 'Author: N/A', 'Highlights:', '同一地址'].join('\n'),
].join('\n\n---\n\n');

// tavily-mcp's formatResults for tavily_search.
const TAVILY_SEARCH = [
  'Request ID: req-1',
  'Answer: 模型写的总结，不是来源',
  'Detailed Results:',
  '',
  'Title: 黄历宜忌',
  'ID: 7f3a',
  'URL: https://example.com/almanac',
  'Content: 今日宜出行',
  'Favicon: https://example.com/favicon.ico',
  '',
  'Title: 第二条',
  'URL: https://example.net/2',
  'Content: 第一行',
  '第二行',
  '',
  'Images:',
  '',
  '[1] URL: https://example.com/a.png',
  '   Description: 一张图',
].join('\n');

test('Exa search records keep their highlights, a rule inside them, the date and nothing but http(s) addresses', () => {
  assert.deepEqual(parseWebSearchResults({ text: EXA_SEARCH }), [
    {
      title: '甲辰年运势解读', url: 'https://example.com/jiachen', publishedAt: '2024-02-10T00:00:00.000Z',
      content: '甲辰年天干甲木，地支辰土。\n\n---\n\n辰为水库。',
    },
    { title: 'example.org', url: 'https://example.org/page', content: '全文第一行\n全文第二行' },
  ]);
  assert.deepEqual(parseWebSearchResults({ text: 'No search results found. Please try a different query.' }), []);
});

test('Tavily search records skip the answer, the IDs, the favicons and the image list', () => {
  assert.deepEqual(parseWebSearchResults({ text: TAVILY_SEARCH }), [
    { title: '黄历宜忌', url: 'https://example.com/almanac', content: '今日宜出行' },
    { title: '第二条', url: 'https://example.net/2', content: '第一行\n第二行' },
  ]);
  const raw = 'Detailed Results:\n\nTitle: 带全文\nURL: https://example.com/raw\nContent: 摘要\nRaw Content: 全文\n更多全文\nFavicon: https://example.com/f.ico';
  assert.deepEqual(parseWebSearchResults({ text: raw }), [{ title: '带全文', url: 'https://example.com/raw', content: '摘要' }], 'a search shows the snippet');
  assert.deepEqual(parseWebPage({ text: raw }, 'https://example.com/raw')?.content, '全文\n更多全文', 'a page read shows the page');
});

test('other services are read from structured results, then labelled records, then Markdown links', () => {
  assert.deepEqual(parseWebSearchResults({
    text: '这段文字被忽略',
    structured: { results: [{ title: '结构化', url: 'https://s.example/a', highlights: ['要点一', '要点二'], publishedDate: '2026-01-01' }, { url: 'ftp://s.example/b' }] },
  }), [{ title: '结构化', url: 'https://s.example/a', content: '要点一\n要点二', publishedAt: '2026-01-01' }]);
  assert.deepEqual(parseWebSearchResults({ text: '1. [标题一](https://a.example/x) - 摘要一\n- [标题二](https://b.example/) \n[脚本](javascript:alert(1))' }), [
    { title: '标题一', url: 'https://a.example/x', content: '标题一 - 摘要一' },
    { title: '标题二', url: 'https://b.example/', content: '' },
  ]);
  assert.deepEqual(parseWebSearchResults({ text: '没有任何地址的回答' }), []);
});

test('an Exa page read keeps the page text with its rules and quoted labels, without the per-address errors', () => {
  const text = [
    '# 页面标题',
    'URL: https://example.com/page',
    'Published: 2024-01-01',
    'Author: 李四',
    '',
    '正文第一段',
    '',
    '---',
    '',
    'Title: 正文里引用的标签',
    '正文第二段',
    '',
    '# 另一页',
    'URL: https://example.com/other',
    '',
    '另一页的正文',
    '',
    'Error fetching https://bad.example: CRAWL_NOT_FOUND',
  ].join('\n');
  assert.deepEqual(parseWebPage({ text }, 'https://example.com/page#top'), {
    title: '页面标题', url: 'https://example.com/page', publishedAt: '2024-01-01',
    content: '正文第一段\n\n---\n\nTitle: 正文里引用的标签\n正文第二段',
  });
  assert.equal(parseWebPage({ text }, 'https://example.com/other/')?.content, '另一页的正文');
  assert.equal(parseWebPage({ text }, 'https://example.com/redirected')?.title, '页面标题', 'a page that moved is the first one read');
});

test('a Tavily extract without titles, a plain text page, and services that found nothing', () => {
  const extract = 'Detailed Results:\n\nURL: https://example.com/a\nRaw Content: # 标题\n\n第一段\n\nURL: https://example.com/b\nRaw Content: 另一页';
  assert.deepEqual(parseWebPage({ text: extract }, 'https://example.com/b'), { title: 'example.com', url: 'https://example.com/b', content: '另一页' });
  assert.equal(parseWebPage({ text: extract }, 'https://example.com/a')?.content, '# 标题\n\n第一段');
  assert.deepEqual(parseWebPage({ text: '网页的全部正文\n\n\n\n第二段' }, 'https://www.example.com/p'), {
    title: 'example.com', url: 'https://www.example.com/p', content: '网页的全部正文\n\n第二段',
  });
  assert.equal(parseWebPage({ text: 'No content found for the provided URL(s).' }, 'https://example.com/p'), null);
  assert.equal(parseWebPage({ text: 'Request ID: r\nDetailed Results:' }, 'https://example.com/p'), null);
  assert.equal(parseWebPage({ text: 'Title: 空页\nURL: https://example.com/p' }, 'https://example.com/p'), null, 'records without text are not a page');
});
