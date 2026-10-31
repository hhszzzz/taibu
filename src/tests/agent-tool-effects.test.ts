import { test, beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAgentTools } from '../lib/agent/tools.server';
import type { DomainTool } from '../lib/agent/types';
import { MemoryStore, row } from './helpers/agent-runtime-fixture';
import { createMockScopedDb } from './helpers/db-mock';

beforeEach((t) => {
  assert.ok('mock' in t);
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
});

/** Fails the next agent_cache_tool write after the tool has already computed its result. */
class FailingCacheStore extends MemoryStore {
  failNextCache = true;
  override async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (name === 'agent_cache_tool' && this.failNextCache) {
      this.failNextCache = false;
      throw new Error('AGENT_CACHE_UNAVAILABLE');
    }
    return super.rpc<T>(name, args);
  }
}

/** Search and page services that serve every member, faked where tools.server.ts routes to them. */
function withWebSearch(t: TestContext) {
  const route = require('../lib/agent/mcp/web-route.server') as typeof import('../lib/agent/mcp/web-route.server');
  t.mock.method(route, 'webRouteAvailable', async () => true);
  const search = t.mock.method(route, 'searchWeb', async () => [{ title: '来源', url: 'https://example.com/source', content: '摘要' }]);
  const fetch = t.mock.method(route, 'fetchWebPage', async (url: string) => ({ title: '网页', url, content: '正文' }));
  return { search, fetch };
}

const find = (tools: DomainTool[], name: string) => {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `${name} is registered`);
  return tool;
};

const plan = { revision: 0, items: [{ id: 'chart', title: '排盘并复述盘面', status: 'in_progress' }] };

test('a failed tool cache write leaves no checkpoint state, so the model can retry the same step', async (t) => {
  withWebSearch(t);
  const store = new FailingCacheStore(), run = row();
  run.input.webEnabled = true;
  const tools = await createAgentTools(store, run, run.checkpoint);

  await assert.rejects(find(tools, 'todo_write').execute('1:todo', plan), /AGENT_CACHE_UNAVAILABLE/);
  assert.equal(run.checkpoint.todos, undefined, 'the revision must not advance for an unrecorded result');
  // The model saw revision 0 fail, so its retry still uses revision 0.
  await find(tools, 'todo_write').execute('2:todo', plan);
  assert.deepEqual(run.checkpoint.todos, { revision: 1, items: plan.items });

  store.failNextCache = true;
  await assert.rejects(find(tools, 'ask_user').execute('3:ask', { question: '出生时间？' }), /AGENT_CACHE_UNAVAILABLE/);
  assert.equal(run.checkpoint.question, undefined, 'an unrecorded question cannot pause the task');
  assert.equal(run.checkpoint.questionId, undefined);

  store.failNextCache = true;
  await assert.rejects(find(tools, 'web_search').execute('4:web', { query: '庚金' }), /AGENT_CACHE_UNAVAILABLE/);


  assert.deepEqual(run.checkpoint.parts.map((part) => part.type), ['todo'], 'no question or source part for failed writes');
});

test('fresh results and cache replays derive identical checkpoint state without re-running tools', async (t) => {
  const web = withWebSearch(t);
  const store = new MemoryStore();
  const calls: Array<[name: string, callId: string, args: Record<string, unknown>]> = [
    ['todo_write', '1:todo', plan],
    ['web_search', '2:web', { query: '庚金' }],
    ['ask_user', '4:ask', { questions: [{ id: 'birth', question: '她的出生时间？' }, { id: 'calendar', question: '公历还是农历？', options: [{ id: 'solar', label: '公历' }] }] }],
  ];
  const replay = async () => {
    const run = row();
    run.input.webEnabled = true;
    const tools = await createAgentTools(store, run, run.checkpoint);
    for (const [name, callId, args] of calls) await find(tools, name).execute(callId, args);
    return JSON.parse(JSON.stringify(run.checkpoint)) as typeof run.checkpoint;
  };

  const fresh = await replay();
  const writes = store.writes.filter((write) => write.name === 'agent_cache_tool').length;
  const restored = await replay();

  assert.equal(web.search.mock.callCount(), 1, 'replay never repeats the network request');
  assert.equal(store.writes.filter((write) => write.name === 'agent_cache_tool').length, writes, 'replay never recaches');
  assert.equal(fresh.question, '她的出生时间？\n\n公历还是农历？');
  assert.equal(fresh.questionId, '4:ask');
  assert.deepEqual(fresh.parts.map((part) => `${part.type}:${part.id}`), ['todo:task-list', 'source:2:web:0', 'question:4:ask']);
  for (const key of ['todos', 'question', 'questions', 'questionId', 'parts'] as const)
    assert.deepEqual(restored[key], fresh[key], key);
});

test('knowledge hit counts are recorded only for searches whose results were cached', async () => {
  const store = new MemoryStore(), run = row();
  store.drafts.set('9:kb', {
    id: randomUUID(), call_id: '9:kb', tool_name: 'search_knowledge', kind: 'tool', args: { query: '庚金' },
    result: { content: [], details: [{ id: 'chunk', content: '庚金带煞，刚健为最。' }, { id: 'chunk-2', content: '得水而清，得火而锐。' }] },
  });
  const tools = await createAgentTools(store, run, run.checkpoint);
  await find(tools, 'search_knowledge').execute('9:kb', { query: '庚金' });
  await find(tools, 'search_knowledge').execute('9:kb', { query: '庚金' });
  assert.deepEqual(run.checkpoint.knowledgeQueries, { '9:kb': 2 }, 'replays overwrite one entry per call');
});

test('search results are numbered after the conversation\'s earlier evidence, once per call', async (t) => {
  withWebSearch(t);
  const store = new MemoryStore(), run = row();
  run.input.webEnabled = true;
  run.checkpoint.citations = { base: 4, calls: {} };
  store.drafts.set('3:kb', {
    id: randomUUID(), call_id: '3:kb', tool_name: 'search_knowledge', kind: 'tool', args: { query: '庚金' },
    result: { content: [], details: [{ id: 'a', content: '庚金带煞', cite: 7 }, { id: 'b', content: '得火而锐', cite: 8 }] },
  });
  const tools = await createAgentTools(store, run, run.checkpoint);
  const cites = (result: { details: unknown }) => (result.details as Array<{ cite?: number }>).map((item) => item.cite);
  const first = await find(tools, 'web_search').execute('1:web', { query: '庚金' });
  assert.deepEqual(cites(first), [5]);
  assert.match(first.content[0].type === 'text' ? first.content[0].text : '', /"cite":5/, 'the model reads the number it may cite');
  assert.deepEqual(cites(await find(tools, 'web_search').execute('1:web', { query: '庚金' })), [5], 'a replay returns the stored number');
  assert.deepEqual(cites(await find(tools, 'web_search').execute('2:web', { query: '辛金' })), [6]);
  await find(tools, 'search_knowledge').execute('3:kb', { query: '庚金' });
  assert.deepEqual(run.checkpoint.citations, { base: 4, calls: { '1:web': 5, '2:web': 6, '3:kb': 8 } }, 'replayed stamps advance the next number');
  assert.deepEqual(cites(await find(tools, 'web_search').execute('4:web', { query: '壬水' })), [9]);
  const page = await find(tools, 'web_fetch').execute('5:page', { url: 'https://example.com/page' });
  assert.deepEqual(page.details, [{ title: '网页', url: 'https://example.com/page', content: '正文', cite: 10 }], 'a page read is cited like a search result');
  assert.ok(run.checkpoint.parts.some((part) => part.type === 'source' && part.id === '5:page:0' && part.url === 'https://example.com/page'));
  assert.deepEqual(run.checkpoint.citations, { base: 4, calls: { '1:web': 5, '2:web': 6, '3:kb': 8, '4:web': 9, '5:page': 10 } });
});

test('a page read keeps its full text for the model and only an excerpt in the source part', async (t) => {
  const web = withWebSearch(t);
  web.fetch.mock.mockImplementation(async (url: string) => ({ title: '长页', url, content: '字'.repeat(2_000) }));
  const store = new MemoryStore(), run = row();
  run.input.webEnabled = true;
  const tools = await createAgentTools(store, run, run.checkpoint);
  const result = await find(tools, 'web_fetch').execute('1:page', { url: 'https://example.com/long' });
  assert.equal((result.details as Array<{ content: string }>)[0].content.length, 2_000);
  const source = run.checkpoint.parts.find((part) => part.type === 'source');
  assert.ok(source?.type === 'source' && source.content === `${'字'.repeat(1_500)}…`);
});

test('a task created before numbering keeps its results unnumbered', async (t) => {
  withWebSearch(t);
  const store = new MemoryStore(), run = row();
  run.input.webEnabled = true;
  const tools = await createAgentTools(store, run, run.checkpoint);
  const result = await find(tools, 'web_search').execute('1:web', { query: '庚金' });
  assert.deepEqual(result.details, [{ title: '来源', url: 'https://example.com/source', content: '摘要' }]);
  assert.equal(run.checkpoint.citations, undefined, 'its answer could not have been told any number');
});

/** user_settings has memory on; agent_write_memory returns the full table row like the SQL function. */
class MemoryToolStore extends MemoryStore {
  constructor() {
    super();
    const settings = { chat_preferences: { memoryEnabled: true } };
    const query = { select: () => query, where: () => query, executeTakeFirst: async () => settings };
    Object.defineProperty(this, 'db', { value: createMockScopedDb({ tx: async work => work({ selectFrom: () => query } as never) }) });
  }
  override async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (name !== 'agent_write_memory') return super.rpc<T>(name, args);
    this.writes.push({ name, args: structuredClone(args) });
    return {
      id: randomUUID(), user_id: randomUUID(), fingerprint: 'fingerprint', source_run_id: args.p_run_id, source_text: args.p_evidence,
      title: args.p_title, content: args.p_content, kind: args.p_kind, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z',
    } as T;
  }
}

test('a remembered fact exposes only the fields the account owner manages', async () => {
  const store = new MemoryToolStore(), run = row();
  run.input.memoryEnabled = true;
  const tools = await createAgentTools(store, run, run.checkpoint);
  const fact = '以后都用公历时间来记录';
  const result = await find(tools, 'remember_user_fact').execute('7:memory', { title: '历法偏好', content: fact, kind: 'preference', evidence: fact });
  assert.deepEqual(Object.keys(result.details as object).sort(), ['content', 'id', 'kind', 'title', 'updated_at']);
  assert.equal((result.details as { content: string }).content, fact);
  for (const hidden of ['user_id', 'fingerprint', 'source_run_id', run.id]) assert.ok(!result.content[0].text.includes(hidden), `${hidden} stays out of the model and the transcript`);
});
