import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentTools, type JsonObject } from '@earendil-works/pi-ai';
import { DEFERRED_TOOL_NAMES, listToolDefinitions, rankDeferredTools, toolSearchTerms } from 'taibu-core/mcp';
import { MockLanguageModelV3 } from 'ai/test';
import type { AgentRunRow } from '../lib/agent/store.server';
import type { AgentPart } from '../lib/agent/types';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { AGENT_CORE_DEFERRED_TOOLS, AGENT_DATA_DEFERRED_TOOLS, AGENT_DEFERRED_TOOLS, AGENT_TOOL_SEARCH_TOOL, isAgentDeferredTool } from '../lib/agent/tool-catalog';
import { AGENT_TOOL_SEARCH_LIMIT } from '../lib/agent/tool-search.server';
import { summarizeAgentTool } from '../components/chat/agent/presentation';
import { config, MemoryStore, row, scripted } from './helpers/agent-runtime-fixture';

beforeEach((t) => {
  assert.ok('mock' in t);
  const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const sdk = require('../lib/ai/providers/ai-sdk-provider') as typeof import('../lib/ai/providers/ai-sdk-provider');
  t.mock.method(credits, 'getUserCreditInfo', async () => ({ membership: 'plus', credits: 10, expiresAt: null }));
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
  t.mock.method(sdk, 'isModelAvailable', () => true);
  t.mock.method(sdk, 'createModelFromConfig', () => new MockLanguageModelV3());
});

type ToolPart = Extract<AgentPart, { type: 'tool' }>;
const finished = (store: MemoryStore) => store.writes.find(write => write.name === 'agent_finish_run')!;
const toolParts = (store: MemoryStore) => ((finished(store).args.p_message as AgentRunRow['public_message']).agent?.parts ?? [])
  .filter((part): part is ToolPart => part.type === 'tool');

const definitions = listToolDefinitions();
const candidates = definitions.filter(definition => isAgentDeferredTool(definition.name))
  .map(definition => ({ name: definition.name, description: definition.description }));
const titles = new Map(definitions.map(definition => [definition.name, definition.title]));
const rank = (query: string, limit?: number) => rankDeferredTools(query, candidates, titles, limit);

test('deferred tools are the fourteen low-frequency Core tools, the notes and conversation searches, and every MCP tool', () => {
  assert.deepEqual([...AGENT_CORE_DEFERRED_TOOLS].sort(), [
    'almanac_select', 'astrology_point', 'bazi_dayun', 'bazi_hepan', 'bazi_liunian_scan', 'bazi_pillars_resolve', 'bazi_relations',
    'bazi_wuxing', 'daliuren_lessons', 'liuyao_line', 'qimen_palace', 'ziwei_flying_star', 'ziwei_horoscope', 'ziwei_palace',
  ]);
  for (const name of AGENT_CORE_DEFERRED_TOOLS) assert.ok(definitions.some(definition => definition.name === name), `${name} is a Core tool`);
  // The browser-safe catalogue keeps its own copy; the MCP servers defer the same Core tools.
  assert.deepEqual([...AGENT_CORE_DEFERRED_TOOLS], [...DEFERRED_TOOL_NAMES]);
  assert.deepEqual([...AGENT_DATA_DEFERRED_TOOLS], ['read_user_notes', 'search_conversations']);
  assert.deepEqual([...AGENT_DEFERRED_TOOLS].sort(), [...AGENT_CORE_DEFERRED_TOOLS, ...AGENT_DATA_DEFERRED_TOOLS].sort());
  assert.equal(isAgentDeferredTool('read_user_notes'), true);
  assert.equal(isAgentDeferredTool('list_user_data'), false, 'the listing is how a reading starts, so it stays offered');
  assert.equal(isAgentDeferredTool('mcp__archive__search'), true);
  assert.equal(isAgentDeferredTool('bazi'), false);
  assert.equal(isAgentDeferredTool('__proto__'), false);
});

/** The prompt sections Pi sends with a request, as one string to match against. */
const systemText = (messages: Parameters<NonNullable<Parameters<typeof scripted>[1]>>[0]) => JSON.stringify(messages.filter(message => message.role === 'system'));

test('notes and earlier conversations load by their Chinese titles, and only with the task that has them', async () => {
  const run = row();
  run.input.memoryEnabled = true;
  const offered: string[][] = [], prompts: string[] = [];
  const store = new MemoryStore();
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'notes', name: AGENT_TOOL_SEARCH_TOOL, arguments: { query: '笔记' } }];
    if (index === 1) return [{ type: 'toolCall', id: 'history', name: AGENT_TOOL_SEARCH_TOOL, arguments: { query: '以往对话' } }];
    return [{ type: 'text', text: '已加载' }];
  }, messages => { offered.push(getCurrentTools(messages).map(tool => tool.name)); prompts.push(systemText(messages)); }) });
  const [notes, history] = toolParts(store).filter(part => part.name === AGENT_TOOL_SEARCH_TOOL).map(part => (part.output as { loaded: string[] }).loaded);
  assert.equal(notes[0], 'read_user_notes');
  assert.equal(history[0], 'search_conversations');
  for (const name of AGENT_DATA_DEFERRED_TOOLS) assert.ok(!offered[0].includes(name), `${name} waits to be loaded`);
  assert.ok(offered[2].includes('read_user_notes') && offered[2].includes('search_conversations'));
  // The guidance names them only when they are there to load: conversation search needs long-term memory.
  assert.match(prompts[0], /读取用户的每日笔记与心情、用户以往对话中的提问与结论/);
  assert.match(prompts[0], /「笔记」「以往对话」/);
  const plainPrompts: string[] = [];
  await executeAgentRun(new MemoryStore(), row(), undefined, { config, streamFn: scripted(() => [{ type: 'text', text: '好' }], messages => { plainPrompts.push(systemText(messages)); }) });
  assert.match(plainPrompts[0], /读取用户的每日笔记与心情，/);
  assert.doesNotMatch(plainPrompts[0], /以往对话中的提问与结论/);
});

test('a Chinese query finds the tool a model means, before tools that merely mention the words', () => {
  assert.deepEqual(toolSearchTerms('大运'), ['大运']);
  assert.deepEqual(toolSearchTerms('流年 扫描'), ['流年', '扫描']);
  assert.deepEqual(toolSearchTerms('dayun'), ['dayun']);
  assert.equal(rank('大运')[0], 'bazi_dayun');
  assert.equal(rank('起运')[0], 'bazi_dayun');
  assert.equal(rank('流年扫描')[0], 'bazi_liunian_scan');
  assert.equal(rank('飞星四化')[0], 'ziwei_flying_star');
  assert.equal(rank('择日')[0], 'almanac_select');
  assert.equal(rank('合盘')[0], 'bazi_hepan');
  assert.equal(rank('合婚')[0], 'bazi_hepan');
  assert.equal(rank('两人八字合不合')[0], 'bazi_hepan');
  assert.equal(rank('动爻')[0], 'liuyao_line');
  assert.equal(rank('三方四正')[0], 'ziwei_palace');
  assert.equal(rank('三传四课')[0], 'daliuren_lessons');
  assert.equal(rank('dayun')[0], 'bazi_dayun');
  assert.equal(rank('qimen palace')[0], 'qimen_palace');
  assert.deepEqual(rank('完全不存在的东西'), []);
  assert.deepEqual(rank('   '), []);
  assert.equal(rank('八字', 2).length, 2, 'the limit caps the matches');
});

test('the model loads a deferred tool before it is offered, and the loaded tool stays for the next request', async () => {
  const store = new MemoryStore(), run = row();
  const offered: string[][] = [];
  const dayun = definitions.find(definition => definition.name === 'bazi_dayun')!.inputSchema.examples![0] as JsonObject;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'search', name: AGENT_TOOL_SEARCH_TOOL, arguments: { query: '大运' } }];
    if (index === 1) return [{ type: 'toolCall', id: 'dayun', name: 'bazi_dayun', arguments: dayun }];
    return [{ type: 'text', text: '大运已排好' }];
  }, messages => offered.push(getCurrentTools(messages).map(tool => tool.name))) });
  assert.equal(finished(store).args.p_status, 'completed');
  assert.ok(offered[0].includes('bazi') && offered[0].includes(AGENT_TOOL_SEARCH_TOOL));
  for (const name of ['bazi_dayun', 'bazi_relations', 'ziwei_horoscope', 'almanac_select']) assert.ok(!offered[0].includes(name), `${name} waits to be loaded`);
  const parts = toolParts(store);
  const search = parts.find(part => part.name === AGENT_TOOL_SEARCH_TOOL)!;
  const loaded = (search.output as { loaded: string[] }).loaded;
  assert.ok(loaded.includes('bazi_dayun'), 'the tool the query names is loaded');
  assert.ok(!loaded.includes('almanac_select') && !loaded.includes('liuyao_line'), 'tools the query does not name stay out');
  for (const name of loaded) assert.ok(offered[1].includes(name), `${name} is offered from the next request`);
  assert.ok(!offered[1].includes('almanac_select'), 'a tool that was not loaded is still not offered');
  assert.equal(search.status, 'completed');
  assert.equal(summarizeAgentTool(search), `「大运」 · 加载 ${loaded.length} 个工具`);
  assert.equal(parts.find(part => part.name === 'bazi_dayun')?.status, 'completed', 'the loaded tool runs');
  assert.equal(parts.filter(part => part.name === 'bazi_dayun' && part.status === 'completed').length, 1);
});

test('a search with no match says so and loads nothing', async () => {
  const store = new MemoryStore(), run = row();
  let offered: string[] = [];
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'search', name: AGENT_TOOL_SEARCH_TOOL, arguments: { query: '完全不存在的东西' } }];
    return [{ type: 'text', text: '没有可用工具' }];
  }, messages => { offered = getCurrentTools(messages).map(tool => tool.name); }) });
  const search = toolParts(store).find(part => part.name === AGENT_TOOL_SEARCH_TOOL)!;
  assert.deepEqual(search.output, { loaded: [] });
  assert.equal(search.status, 'completed');
  assert.ok(!offered.includes('bazi_dayun'));
  assert.equal(AGENT_TOOL_SEARCH_LIMIT, 8);
});
