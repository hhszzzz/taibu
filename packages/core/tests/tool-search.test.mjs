import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFERRED_TOOL_NAMES,
  TOOL_SEARCH_MAX_LIMIT,
  getServerInstructions,
  getToolGatewayDefinitions,
  isDeferredTool,
  listToolDefinitions,
  parseToolListMode,
  renderToolSearchResult,
  searchDeferredTools,
} from '../dist/mcp/index.js';

const definitions = listToolDefinitions();
const CHART_TOOLS = ['bazi', 'ziwei', 'liuyao', 'meihua', 'tarot', 'taiyi', 'almanac', 'qimen', 'daliuren', 'xiaoliuren', 'astrology'];

test('the deferred tools are fourteen Core tools, none of them a chart', () => {
  assert.equal(DEFERRED_TOOL_NAMES.length, 14);
  for (const name of DEFERRED_TOOL_NAMES) assert.ok(definitions.some(tool => tool.name === name), name);
  for (const name of CHART_TOOLS) assert.equal(isDeferredTool(name), false, name);
  assert.deepEqual(definitions.filter(tool => !isDeferredTool(tool.name)).map(tool => tool.name).sort(), [...CHART_TOOLS].sort());
  for (const name of ['__proto__', 'constructor', '']) assert.equal(isDeferredTool(name), false, JSON.stringify(name));
});

test('the tool list mode is all unless set to core, and anything else is refused', () => {
  for (const value of [undefined, '', 'all']) assert.equal(parseToolListMode(value), 'all');
  assert.equal(parseToolListMode('core'), 'core');
  for (const value of ['CORE', 'lazy', ' core']) assert.throws(() => parseToolListMode(value), /只能是 all 或 core/);
  assert.match(getServerInstructions('all'), /load_analysis_method/);
  assert.doesNotMatch(getServerInstructions('all'), /tool_search/);
  assert.match(getServerInstructions('core'), /tool_search[^\n]*tool_call/);
});

test('a search returns whole deferred definitions, best first, and never a listed tool', () => {
  const [dayun] = searchDeferredTools('大运', definitions);
  assert.equal(dayun.name, 'bazi_dayun');
  assert.deepEqual(dayun.inputSchema, definitions.find(tool => tool.name === 'bazi_dayun').inputSchema);
  assert.ok(searchDeferredTools('八字', definitions, TOOL_SEARCH_MAX_LIMIT).every(tool => isDeferredTool(tool.name)), 'the bazi chart tool is never a match');
  assert.equal(searchDeferredTools('八字', definitions, 2).length, 2);
  assert.deepEqual(searchDeferredTools('完全不存在的东西', definitions), []);
  // The candidates are whatever the server lists, e.g. definitions it decorated for place resolution.
  const decorated = definitions.map(tool => ({ ...tool, description: `${tool.description}（已解析地点）` }));
  assert.match(searchDeferredTools('择日', decorated)[0].description, /已解析地点/);
});

test('the gateway calls only deferred tools, and a search result carries what tool_call needs', () => {
  const [search, call] = getToolGatewayDefinitions();
  assert.deepEqual([search.name, call.name], ['tool_search', 'tool_call']);
  assert.deepEqual(search.inputSchema.required, ['query']);
  assert.equal(search.inputSchema.properties.limit.maximum, TOOL_SEARCH_MAX_LIMIT);
  assert.deepEqual(call.inputSchema.properties.name.enum, [...DEFERRED_TOOL_NAMES]);
  assert.deepEqual(call.inputSchema.required, ['name', 'arguments']);
  for (const tool of [search, call]) assert.equal(tool.annotations.readOnlyHint, true);
  const text = renderToolSearchResult(searchDeferredTools('流年扫描', definitions, 1));
  const liunian = definitions.find(tool => tool.name === 'bazi_liunian_scan');
  assert.ok(text.startsWith('找到 1 个工具') && text.includes(`## bazi_liunian_scan（${liunian.title}）`) && text.includes(JSON.stringify(liunian.inputSchema)));
  assert.match(renderToolSearchResult([]), /没有匹配的工具/);
});
