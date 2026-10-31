import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { CallToolResult, Tool } from '@earendil-works/pi-mcp';
import { McpPool } from '../lib/agent/mcp/pool.server';
import { applyMcpSecretChanges } from '../lib/agent/mcp/secrets.server';
import type { McpServerRow } from '../lib/agent/mcp/store.server';
import { WebRouter, WebRouteUnavailableError, fetchArguments, searchArguments } from '../lib/agent/mcp/web-route.server';
import { fakeMcpServer, mcpServerRow } from './helpers/mcp-fixture';

// The tools as exa-mcp-server and tavily-mcp list them, down to the parts the router reads.
const EXA_TOOLS: Tool[] = [
  { name: 'web_search_exa', inputSchema: { type: 'object', properties: { query: { type: 'string' }, numResults: { type: 'number' } }, required: ['query'] } },
  { name: 'web_fetch_exa', inputSchema: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' } }, maxCharacters: { type: 'number' } }, required: ['urls'] } },
];
const TAVILY_TOOLS: Tool[] = [
  { name: 'tavily_search', inputSchema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number', minimum: 5, maximum: 20 }, search_depth: { type: 'string' } }, required: ['query'] } },
  { name: 'tavily_extract', inputSchema: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' } }, format: { type: 'string' } }, required: ['urls'] } },
];

const text = (value: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });
const EXA_FOUND = text('Title: 甲辰年\nURL: https://exa.example/1\nPublished: N/A\nAuthor: N/A\nHighlights:\n要点');
const TAVILY_FOUND = text(`Detailed Results:\n${[1, 2, 3, 4].map(n => `\nTitle: 第${n}条\nURL: https://tavily.example/${n}\nContent: 摘要${n}`).join('\n')}`);

type Respond = (name: string, args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;

/** Exa and Tavily stand-ins behind one pool, with what each answers set per test. */
function setup(t: TestContext, rows: McpServerRow[] = [exaRow(), tavilyRow()]) {
  t.mock.method(console, 'warn', () => undefined);
  const answers: Record<string, Respond> = { exa: () => EXA_FOUND, tavily: () => TAVILY_FOUND };
  const fakes = {
    exa: fakeMcpServer({ tools: EXA_TOOLS, call: (name, args) => answers.exa(name, args) }),
    tavily: fakeMcpServer({ tools: TAVILY_TOOLS, call: (name, args) => answers.tavily(name, args) }),
  };
  const byId = new Map(rows.map(row => [row.id, row.name.startsWith('tavily') ? fakes.tavily : fakes.exa]));
  const pool = new McpPool({ transport: (endpoint) => byId.get(endpoint.id)!.transport() });
  t.after(() => pool.close());
  let clock = 1_000_000;
  const reports: Array<[string, string | null]> = [];
  const router = new WebRouter({
    pool, servers: async () => rows, now: () => clock,
    report: async (id, error) => { reports.push([id, error]); },
  });
  return { router, fakes, answers, reports, advance: (ms: number) => { clock += ms; } };
}

function exaRow(overrides: Partial<McpServerRow> = {}) {
  return mcpServerRow({
    id: '00000000-0000-4000-8000-0000000000e1', name: 'exa', display_name: 'Exa', exposure: 'hidden',
    search_tool: 'web_search_exa', fetch_tool: 'web_fetch_exa', route_priority: 10, ...overrides,
  });
}

function tavilyRow(overrides: Partial<McpServerRow> = {}) {
  return mcpServerRow({
    id: '00000000-0000-4000-8000-0000000000e2', name: 'tavily', display_name: 'Tavily', exposure: 'hidden',
    search_tool: 'tavily_search', fetch_tool: 'tavily_extract', route_priority: 20, ...overrides,
  });
}

test('servers are tried by route order among the enabled ones, with arguments from each tool schema', async (t) => {
  const rows = [
    tavilyRow(), exaRow(),
    exaRow({ id: '00000000-0000-4000-8000-0000000000e3', name: 'exa_first', route_priority: 0 }),
    exaRow({ id: '00000000-0000-4000-8000-0000000000e4', name: 'exa_off', route_priority: 1, is_enabled: false }),
    exaRow({ id: '00000000-0000-4000-8000-0000000000e5', name: 'exa_tools', route_priority: 2, search_tool: null, fetch_tool: null }),
  ];
  const { router, fakes } = setup(t, rows);
  assert.deepEqual((await router.routes('search')).map(row => row.name), ['exa_first', 'exa', 'tavily'],
    'a disabled server and one without a search tool do not count');
  assert.equal(await router.available('search'), true);
  assert.equal(await new WebRouter({ servers: async () => [] }).available('search'), false);
  assert.equal(await new WebRouter({ servers: async () => { throw new Error('database down'); } }).available('search'), false);

  assert.deepEqual(await router.search('  甲辰\n年  '), [{ title: '甲辰年', url: 'https://exa.example/1', content: '要点' }]);
  assert.deepEqual(fakes.exa.state.calls, [{ name: 'web_search_exa', arguments: { query: '甲辰 年', numResults: 5 } }]);
  assert.equal(fakes.tavily.state.calls.length, 0, 'the first server that finds something answers');
});

test('a search moves on after an error, an error result or nothing found, and is empty only when every server answered', async (t) => {
  const { router, fakes, answers } = setup(t);
  answers.exa = () => text('quota exceeded', true);
  const found = await router.search('流年', { limit: 3 });
  assert.deepEqual(found.map(result => result.url), ['https://tavily.example/1', 'https://tavily.example/2', 'https://tavily.example/3']);
  assert.deepEqual(fakes.tavily.state.calls.at(-1), { name: 'tavily_search', arguments: { query: '流年', max_results: 5 } }, 'Tavily takes at least five');

  answers.exa = () => text('No search results found. Please try a different query.');
  answers.tavily = () => text('Detailed Results:');
  assert.deepEqual(await router.search('流年'), []);

  answers.exa = async () => { throw new Error('upstream exploded'); };
  answers.tavily = () => text('Error: invalid API key', true);
  await assert.rejects(router.search('流年'), /^Error: 联网搜索失败：外部服务报错：Error: invalid API key$/u);
  await assert.rejects(setup(t, []).router.search('流年'), WebRouteUnavailableError);
  await assert.rejects(router.search(' \n '), /搜索词不能为空/u);
});

test('a server that fails three times in a row rests for a minute; the admin page shows why until it answers again', async (t) => {
  const { router, fakes, answers, reports, advance } = setup(t);
  answers.exa = () => text('rate limited', true);
  for (let attempt = 0; attempt < 3; attempt++) assert.equal((await router.search('流年')).length, 4);
  assert.equal(fakes.exa.state.calls.length, 3);
  assert.deepEqual(reports, [[exaRow().id, '联网搜索连续失败，已暂停 1 分钟：外部服务报错：rate limited']]);
  await router.search('流年');
  assert.equal(fakes.exa.state.calls.length, 3, 'a resting server is skipped');

  advance(60_000);
  answers.exa = () => EXA_FOUND;
  assert.equal((await router.search('流年'))[0].url, 'https://exa.example/1');
  assert.deepEqual(reports.at(-1), [exaRow().id, null], 'its error clears once it answers');

  const alone = setup(t, [exaRow()]);
  alone.answers.exa = async () => { throw new Error('down'); };
  for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(alone.router.search('流年'), /联网搜索失败/u);
  await assert.rejects(alone.router.search('流年'), (error: Error) =>
    error instanceof WebRouteUnavailableError && /连续出错/u.test(error.message));
});

test('a page read sends the address as each tool takes it, cuts the text, and a page one server cannot read does not rest it', async (t) => {
  const { router, fakes, answers, reports } = setup(t);
  answers.exa = () => text('# 页面\nURL: https://example.com/a\n\n正文');
  assert.deepEqual(await router.fetch('https://example.com/a#part'), { title: '页面', url: 'https://example.com/a', content: '正文' });
  assert.deepEqual(fakes.exa.state.calls[0], { name: 'web_fetch_exa', arguments: { urls: ['https://example.com/a'], maxCharacters: 8000 } });

  answers.exa = () => text('Error fetching URL(s): https://example.com/a: CRAWL_NOT_FOUND', true);
  answers.tavily = () => text(`Detailed Results:\n\nURL: https://example.com/a\nRaw Content: ${'字'.repeat(1_500)}`);
  for (let attempt = 0; attempt < 4; attempt++) {
    const page = await router.fetch('https://example.com/a', { maxChars: 1_000 });
    assert.equal(page.content, `${'字'.repeat(1_000)}\n…（后文省略）`);
  }
  assert.deepEqual(fakes.tavily.state.calls[0], { name: 'tavily_extract', arguments: { urls: ['https://example.com/a'] } });
  assert.equal(fakes.exa.state.calls.length, 5, 'Exa is still asked: the page was at fault, not the server');
  assert.deepEqual(reports, []);

  answers.tavily = () => text('Error: extract failed', true);
  await assert.rejects(router.fetch('https://example.com/a'), /^Error: 网页读取失败：外部服务报错：Error: extract failed$/u);
  answers.tavily = () => text('Detailed Results:');
  await assert.rejects(router.fetch('https://example.com/a'), /没有读到这个网页的正文/u, 'a server answered, but without the page');
  answers.exa = () => text('No content found for the provided URL(s).');
  await assert.rejects(router.fetch('https://example.com/a'), /没有读到这个网页的正文/u);
  await assert.rejects(router.fetch('javascript:alert(1)'), /只能读取 http\(s\) 网页地址/u);
  await assert.rejects(router.fetch('https://user:secret@example.com/'), /账号或密码/u);
});

test('a tool named with hyphens is still found, a missing one is named, and secrets never come back in results', async (t) => {
  const previous = process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = previous;
  });
  const id = exaRow().id;
  const secret = 'exa-secret-key-1234';
  const secretHeaders = applyMcpSecretChanges({ serverId: id, ownerId: null }, 'header', {}, { 'x-api-key': secret });
  const { router, answers } = setup(t, [exaRow({ search_tool: 'web-search-exa', secret_headers: secretHeaders }), tavilyRow({ search_tool: 'missing_tool' })]);
  answers.exa = () => text(`Title: 回显\nURL: https://exa.example/echo\nHighlights:\nkey=${secret}`);
  assert.deepEqual((await router.search('流年'))[0].content, 'key=[REDACTED]');
  answers.exa = () => text(`denied for ${secret}`, true);
  await assert.rejects(router.search('流年'), (error: Error) =>
    /外部服务没有「missing_tool」这个工具/u.test(error.message) && !error.message.includes(secret));
});

test('a cancelled search rejects with the reason instead of moving on', async (t) => {
  const { router, answers, fakes } = setup(t);
  answers.exa = () => new Promise<CallToolResult>(() => undefined);
  const controller = new AbortController();
  const pending = router.search('流年', { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 20));
  controller.abort(new Error('client left'));
  await assert.rejects(pending, /client left/u);
  assert.equal(fakes.tavily.state.calls.length, 0);
});

test('arguments follow whatever names a tool uses for the query, the address, the count and the length', () => {
  const tool = (properties: Record<string, unknown>, required: string[] = []): Tool => ({ name: 'tool', inputSchema: { type: 'object', properties, required } });
  assert.deepEqual(searchArguments(tool({ q: { type: 'string' }, limit: { type: 'integer', maximum: 3 } }), '流年', 5), { q: '流年', limit: 3 });
  assert.deepEqual(searchArguments(tool({ topic: { type: 'string' }, text: { type: 'string' } }, ['text']), '流年', 5), { text: '流年' });
  assert.deepEqual(searchArguments(tool({ count: { type: 'integer', minimum: 1 } }), '流年', 4.6), { query: '流年', count: 5 });
  assert.deepEqual(fetchArguments(tool({ url: { type: 'string' }, max_chars: { type: 'integer', maximum: 5000 } }), 'https://a.example/', 8000), { url: 'https://a.example/', max_chars: 5000 });
  assert.deepEqual(fetchArguments(tool({ urls: { type: 'string' } }), 'https://a.example/', 8000), { urls: 'https://a.example/' });
  assert.deepEqual(fetchArguments(tool({ link: { type: 'string' } }, ['link']), 'https://a.example/', 8000), { link: 'https://a.example/' });
});
