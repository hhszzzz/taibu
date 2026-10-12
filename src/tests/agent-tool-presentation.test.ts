import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToolSuccessPayload, executeTool, listToolDefinitions } from 'taibu-core/mcp';
import { getAgentChart, getAgentDataResults, getAgentSearchResults, getAgentToolArtifactId, getAgentToolText, getAgentUnrepresentedArtifacts, type AgentToolPart } from '../lib/agent/tool-presentation';
import { AGENT_CHART_NAMES, isAgentChartTool } from '../lib/agent/tool-catalog';

test('all eleven real tool results display the persisted reading in default/full formats and after JSON history restore', async () => {
  const definitions = listToolDefinitions();
  for (const name of Object.keys(AGENT_CHART_NAMES)) {
    const definition = definitions.find(tool => tool.name === name)!;
    const input = { ...definition.inputSchema.examples![0] as Record<string, unknown> };
    if (definition.inputSchema.properties?.seed) input.seed = 'ui-presentation-contract';
    if (name === 'tarot') input.referenceYear = 2026;
    if (name === 'astrology') { input.latitude = 31.2304; input.longitude = 121.4737; input.timezone = 'Asia/Shanghai'; }
    const result = await executeTool(name, input);
    for (const detailLevel of ['default', 'full'] as const) {
      const returned = buildToolSuccessPayload(name, result, { detailLevel });
      const tool: AgentToolPart = { type: 'tool', id: name, name, title: name, status: 'completed', input,
        output: { artifactId: name, result: returned.structuredContent }, canonicalText: returned.content.map(item => item.text).join('\n') };
      const before = JSON.stringify(tool);
      const value = getAgentChart(tool);
      assert.ok(value, `${name} ${detailLevel}`);
      assert.equal(value.kind, name);
      assert.ok(value.summary);
      assert.deepEqual(getAgentChart(JSON.parse(before)), value, `${name}: restored history must keep the reading`);
      assert.equal(JSON.stringify(tool), before, 'presentation does not mutate execution data');
      if (value.kind === 'liuyao') {
        assert.equal(value.chart.六爻.length, 6);
        assert.equal(value.chart.卦盘.本卦.卦名, (returned.structuredContent as { 卦盘: { 本卦: { 卦名: string } } }).卦盘.本卦.卦名);
      } else assert.equal(value.chart, returned.structuredContent, 'the view consumes the returned object directly');
      assert.equal(getAgentToolText(tool), tool.canonicalText);
      for (const status of ['pending', 'running', 'awaiting_input', 'failed'] as const) assert.equal(getAgentChart({ ...tool, status }), null);
    }
  }
});

test('invalid, incomplete and unknown tool data cannot invent a replacement chart', () => {
  for (const name of Object.keys(AGENT_CHART_NAMES)) for (const output of [null, [], '{}', {}, { result: null }, { result: {} }, { result: { 四柱: [], 六爻: [], 十二宫位: [] } }]) {
    const tool: AgentToolPart = { type: 'tool', id: name, name, title: name, status: 'completed', output, canonicalText: '真实工具文本' };
    assert.equal(getAgentChart(tool), null);
    assert.equal(getAgentToolText(tool), '真实工具文本');
  }
  for (const name of ['unknown', '__proto__', 'constructor', 'bazi_dayun']) assert.equal(isAgentChartTool(name), false);
});

test('incomplete nested chart fields and duplicate coordinates keep the original text instead of exposing broken targets', async () => {
  const mutations: Record<string, Array<(chart: Record<string, unknown>) => void>> = {
    qimen: [chart => { delete (chart.九宫盘 as Record<string, unknown>[])[0].宫位序号; }, chart => { (chart.九宫盘 as Record<string, unknown>[])[1].宫位序号 = (chart.九宫盘 as Record<string, unknown>[])[0].宫位序号; }],
    taiyi: [chart => { delete ((chart.太乙七十二局 as Record<string, unknown>).十六宫 as Record<string, unknown>[])[0].星将; }, chart => { chart.九星阵列 = [{ 观测层级: '日', 太乙名: '混入另一体系', 宫位: '一宫' }]; }],
    astrology: [chart => { delete chart.命盘锚点; }, chart => { (chart.本命主星 as Record<string, unknown>[])[0].关键相位 = null; }, chart => { ((chart.扩展信息 as Record<string, unknown>).完整相位矩阵 as Record<string, unknown>).本命 = null; }],
    almanac: [chart => { delete chart.神煞参考; }, chart => { (chart.神煞参考 as Record<string, unknown>).吉神宜趋 = {}; }, chart => { chart.时辰吉凶 = '未保存时辰列表'; }],
  };
  for (const [name, changes] of Object.entries(mutations)) {
    const input = { ...listToolDefinitions().find(tool => tool.name === name)!.inputSchema.examples![0] as Record<string, unknown> };
    if (name === 'taiyi') Object.assign(input, { system: 'traditional', mode: 'hour', date: '2026-04-10', hour: 9, timezone: 'Asia/Shanghai' });
    if (name === 'astrology') Object.assign(input, { latitude: 31.2304, longitude: 121.4737, timezone: 'Asia/Shanghai' });
    const returned = buildToolSuccessPayload(name, await executeTool(name, input), { detailLevel: 'full' });
    const canonicalText = returned.content.map(part => part.text).join('\n');
    for (const mutate of changes) {
      const chart = structuredClone(returned.structuredContent) as Record<string, unknown>;
      mutate(chart);
      const tool: AgentToolPart = { type: 'tool', id: name, name, title: name, status: 'completed', output: { result: chart }, canonicalText };
      assert.equal(getAgentChart(tool), null, name);
      assert.equal(getAgentToolText(tool), canonicalText);
    }
  }
});

test('search views keep returned excerpts and only expose HTTP sources', () => {
  const tool: AgentToolPart = { type: 'tool', id: 'search', name: 'web_search', title: '联网查询', status: 'completed', output: [
    { title: '可信来源', url: 'https://example.com/source', content: '返回摘要' },
    { title: '无链接资料', url: 'javascript:alert(1)', content: '保留其文本' }, {},
  ] };
  assert.deepEqual(getAgentSearchResults(tool)?.map(item => [item.title, item.url]), [['可信来源', 'https://example.com/source'], ['无链接资料', null]]);
  assert.equal(getAgentSearchResults({ ...tool, status: 'failed' }), null);
  assert.equal(getAgentSearchResults({ ...tool, name: 'bazi' }), null);
  assert.deepEqual(getAgentSearchResults({ ...tool, output: [] }), []);
  assert.equal(getAgentToolText({ ...tool, name: 'read_user_data', output: [{ type: 'text', text: '已保存命盘' }] }), '已保存命盘');
});

test('knowledge passages are titled by their record heading and keep the stamped number and match method', () => {
  const tool: AgentToolPart = { type: 'tool', id: 'kb', name: 'search_knowledge', title: '知识库检索', status: 'completed', output: [
    { content: '# 《滴天髓》天干论 · 庚金\n庚金带煞，刚健为最。', method: 'fts', cite: 3, metadata: { file_name: 'dts.md', category: '命理古籍' } },
    { content: '八字用神，专求月令。', method: 'vector', cite: 0, metadata: { file_name: '子平真诠.md' } },
    { content: '# 只有标题', method: 'unknown', cite: 2.5, metadata: { category: '命理古籍' } },
  ] };
  assert.deepEqual(getAgentSearchResults(tool)?.map(item => [item.title, item.excerpt, item.source, item.method, item.cite]), [
    ['《滴天髓》天干论 · 庚金', '庚金带煞，刚健为最。', 'dts.md', 'fts', 3],
    ['子平真诠.md', '八字用神，专求月令。', null, 'vector', null],
    ['只有标题', '# 只有标题', '命理古籍', null, null],
  ], 'a heading with no body keeps the chunk as its excerpt; invalid numbers and methods are dropped');
  const web: AgentToolPart = { ...tool, name: 'web_search', output: [{ title: '来源', url: 'https://www.example.com/a', content: '摘要', method: 'fts', cite: 7 }] };
  assert.deepEqual(getAgentSearchResults(web)?.map(item => [item.source, item.method, item.cite]), [['www.example.com', null, 7]], 'web rows name their host and never a knowledge match method');
});

test('personal-data results preserve partial failures and filter incomplete rows', () => {
  const tool: AgentToolPart = { type: 'tool', id: 'data', name: 'list_user_data', title: '资料', status: 'completed', output: {
    items: [{ id: 'chart-id', type: 'bazi_chart', name: '命盘', preview: '真实摘要' }, { id: 'incomplete' }],
    errors: [{ type: 'tarot', message: '查询失败' }],
  } };
  assert.deepEqual(getAgentDataResults(tool), { items: [{ id: 'chart-id', type: 'bazi_chart', name: '命盘', preview: '真实摘要' }], errors: [{ type: 'tarot', message: '查询失败' }] });
  assert.deepEqual(getAgentDataResults({ ...tool, output: { items: [], errors: [{ message: '未知来源失败' }, { type: 'tarot' }] } })?.errors, [{ type: null, message: '未知来源失败' }],
    'an error without a source keeps its message; one without a message is dropped');
  assert.equal(getAgentDataResults({ ...tool, status: 'running' }), null);
});

test('saved artifacts are counted once with their completed chart tool and unrelated history remains visible', () => {
  const tool: AgentToolPart = { type: 'tool', id: 'call', name: 'bazi', title: '八字', status: 'completed', output: { artifactId: 'saved', result: {} } };
  const artifacts = [{ id: 'saved', title: '已保存八字' }, { id: 'legacy', title: '历史记录' }];
  assert.equal(getAgentToolArtifactId(tool), 'saved');
  assert.deepEqual(getAgentUnrepresentedArtifacts([tool], artifacts), [artifacts[1]]);
  assert.deepEqual(getAgentUnrepresentedArtifacts([{ ...tool, status: 'failed' }], artifacts), artifacts);
  assert.deepEqual(getAgentUnrepresentedArtifacts([{ ...tool, name: 'web_search' }], artifacts), artifacts);
  assert.equal(getAgentToolArtifactId({ ...tool, output: { artifactId: 12 } }), null);
});
