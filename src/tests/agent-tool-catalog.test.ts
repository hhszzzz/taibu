import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDerivedToolSource, listToolDefinitions } from 'taibu-core/mcp';
import type { JsonObject } from '@earendil-works/pi-ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { AgentRunRow } from '../lib/agent/store.server';
import { CODEMODE_TOOL_NAME } from '@earendil-works/pi-durable/codemode';
import {
  AGENT_BACKGROUND_TOOL, AGENT_CHART_NAMES, AGENT_CODEMODE_TOOL, AGENT_CORE_DEFERRED_TOOLS, AGENT_DATA_DEFERRED_TOOLS, AGENT_DEFERRED_TOOLS, AGENT_DRILLDOWN_BASES,
  AGENT_MODEL_ONLY_TOOLS, AGENT_PLAN_GATED_TOOLS,
  AGENT_SUBMIT_PLAN_TOOL, AGENT_TOOL_SEARCH_TOOL,
  getAgentDrilldownBase, getAgentExtensionToolTitle, getAgentToolFamily, isAgentDeferredTool,
  isAgentChartTool, isAgentMemberTool, projectsAgentCanonicalText, returnsAgentScriptResult,
} from '../lib/agent/tool-catalog';
import { getAgentToolText, type AgentToolPart } from '../lib/agent/tool-presentation';
import { createAgentTools } from '../lib/agent/tools.server';
import { createParallelExtension } from '../lib/agent/parallel.server';
import { createBackgroundAgents } from '../lib/agent/background.server';
import { executeAgentRun } from '../lib/agent/runtime.server';
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

test('every Core tool and every registered Agent tool belongs to a presentation family', async () => {
  for (const definition of listToolDefinitions()) {
    const derived = getDerivedToolSource(definition.name);
    assert.equal(getAgentToolFamily(definition.name), derived ? 'drilldown' : getAgentToolFamily(definition.name), definition.name);
    assert.ok(['chart', 'calculation', 'drilldown'].includes(getAgentToolFamily(definition.name)), definition.name);
    // The browser-safe catalog names the same base as Core's contract.
    assert.equal(getAgentDrilldownBase(definition.name), derived?.base ?? null, definition.name);
    if (derived) assert.equal(projectsAgentCanonicalText(definition.name), true, definition.name);
  }
  assert.deepEqual(Object.keys(AGENT_DRILLDOWN_BASES).sort(), listToolDefinitions().filter(item => getDerivedToolSource(item.name)).map(item => item.name).sort());
  const previous = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = randomUUID();
  try {
    const run = row();
    run.input.webEnabled = true;
    run.input.memoryEnabled = true;
    const tools = await createAgentTools(new MemoryStore(), run, run.checkpoint);
    const parallel = createParallelExtension([], () => { throw new Error('the harness is not opened in this test'); });
    const background = createBackgroundAgents([]).extension;
    const names = [...tools.map((tool) => tool.name), ...[...parallel.tools ?? [], ...background.tools ?? []].map((tool) => tool.name)];
    assert.ok(names.includes('web_search') && names.includes('remember_user_fact') && names.includes('parallel_analysis') && names.includes(AGENT_BACKGROUND_TOOL));
    // The user's own material: notes, earlier conversations and the archive the model writes or proposes.
    for (const name of [...AGENT_DATA_DEFERRED_TOOLS, 'record_user_event', 'propose_archive_entry']) assert.ok(names.includes(name), name);
    for (const name of names) assert.notEqual(getAgentToolFamily(name), 'other', `${name} needs a family in tool-catalog.ts`);
    // Code mode: the tools a script may not call are real tools, and the dispatching tools say so themselves.
    // submit_plan is installed by the runtime in plan mode, so it is not among createAgentTools' own tools.
    for (const name of AGENT_MODEL_ONLY_TOOLS) assert.ok(names.includes(name) || name === AGENT_SUBMIT_PLAN_TOOL, `${name} is not a registered tool`);
    assert.deepEqual(parallel.tools?.find(tool => tool.name === 'parallel_analysis')?.callers, ['model']);
    assert.deepEqual(background.tools?.find(tool => tool.name === AGENT_BACKGROUND_TOOL)?.callers, ['model']);
    assert.ok(isAgentMemberTool('parallel_analysis') && isAgentMemberTool(AGENT_BACKGROUND_TOOL) && !isAgentMemberTool('bazi'));
    for (const name of names) assert.equal(returnsAgentScriptResult(name), ['chart', 'calculation', 'drilldown'].includes(getAgentToolFamily(name)) && !AGENT_MODEL_ONLY_TOOLS.has(name), name);
  } finally {
    if (previous === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous;
  }
  assert.equal(getAgentToolFamily('mcp__archive__search'), 'external');
  assert.equal(getAgentToolFamily('focus_chart'), 'chart');
  assert.equal(AGENT_CODEMODE_TOOL, CODEMODE_TOOL_NAME, 'the catalog names Pi’s code mode tool');
  assert.equal(getAgentToolFamily(AGENT_CODEMODE_TOOL), 'code');
  for (const name of ['bazi_dayun', 'bazi_pillars_resolve', 'ziwei_horoscope', 'ziwei_flying_star', 'inspect_chart', 'read_user_data'])
    assert.equal(projectsAgentCanonicalText(name), true, name);
  for (const name of ['focus_chart', 'web_search', 'todo_write', 'mcp__archive__search'])
    assert.equal(projectsAgentCanonicalText(name), false, `${name} returns structured data, not canonical text`);
  assert.equal(getAgentExtensionToolTitle(AGENT_CODEMODE_TOOL), '运行脚本');
  assert.equal(getAgentExtensionToolTitle(AGENT_TOOL_SEARCH_TOOL), '查找工具');
  assert.equal(getAgentExtensionToolTitle(AGENT_SUBMIT_PLAN_TOOL), '提交计划');
  assert.equal(getAgentExtensionToolTitle(AGENT_BACKGROUND_TOOL), '后台子分析');
  assert.deepEqual([...AGENT_PLAN_GATED_TOOLS].sort(), [AGENT_BACKGROUND_TOOL, 'parallel_analysis', 'record_user_event', 'remember_user_fact']);
  // 低频工具按需加载；MCP 工具是否按需由所属服务的暴露方式决定。
  for (const name of AGENT_CORE_DEFERRED_TOOLS) assert.ok(listToolDefinitions().some(definition => definition.name === name), `${name} is a Core tool`);
  assert.deepEqual([...AGENT_DEFERRED_TOOLS].sort(), [...AGENT_CORE_DEFERRED_TOOLS, ...AGENT_DATA_DEFERRED_TOOLS].sort());
  assert.equal(isAgentDeferredTool('mcp__archive__search'), false, 'an MCP server sets its own exposure');
  assert.equal(isAgentDeferredTool('bazi'), false);
  assert.equal(projectsAgentCanonicalText(AGENT_TOOL_SEARCH_TOOL), false);
  for (const name of ['unknown', '__proto__', 'constructor', 'toString', '']) {
    assert.equal(getAgentToolFamily(name), 'other', JSON.stringify(name));
    assert.equal(isAgentChartTool(name), false);
    assert.equal(projectsAgentCanonicalText(name), false);
    assert.equal(returnsAgentScriptResult(name), false);
    assert.equal(getAgentExtensionToolTitle(name), undefined, JSON.stringify(name));
    assert.equal(isAgentDeferredTool(name), false, JSON.stringify(name));
  }
});

test('the projection keeps canonical text on every Core chart and calculation for text fallbacks', async () => {
  const definitions = listToolDefinitions();
  const calculations = definitions.filter(definition => getAgentToolFamily(definition.name) === 'calculation').map(definition => definition.name);
  assert.deepEqual(calculations.sort(), ['almanac_select', 'bazi_dayun', 'bazi_hepan', 'bazi_hour_candidates', 'bazi_pillars_resolve', 'ziwei_flying_star', 'ziwei_horoscope']);
  const charts = [...Object.keys(AGENT_CHART_NAMES), ...calculations].map((name) => {
    const args = { ...(definitions.find((definition) => definition.name === name)!.inputSchema.examples![0] as Record<string, unknown>) };
    // Agent seeds come from the task and call; explicit seeds are blocked by policy.
    delete args.seed;
    delete args.seedScope;
    if (name === 'astrology') Object.assign(args, { latitude: 31.2304, longitude: 121.4737, timezone: 'Asia/Shanghai' });
    return { name, args: args as JsonObject };
  });
  const store = new MemoryStore(), run = row();
  // Calculations are deferred: the model loads each one by name before calling it, as a reading would.
  const rounds = charts.flatMap((chart, index) => [
    ...(isAgentDeferredTool(chart.name) ? [[{ type: 'toolCall' as const, id: `search-${index}`, name: AGENT_TOOL_SEARCH_TOOL, arguments: { query: chart.name } }]] : []),
    [{ type: 'toolCall' as const, id: `chart-${index}`, name: chart.name, arguments: chart.args }],
  ]);
  const streamFn = scripted((index) => {
    if (index < rounds.length) return rounds[index];
    return [{ type: 'text', text: '已完成全部盘面' }];
  });
  await executeAgentRun(store, run, undefined, { config, streamFn });
  const finish = store.writes.find((write) => write.name === 'agent_finish_run')!;
  const message = finish.args.p_message as AgentRunRow['public_message'];
  assert.equal(finish.args.p_status, 'completed', message.agent?.error);
  const tools = (message.agent?.parts ?? []).filter((part): part is AgentToolPart => part.type === 'tool');
  for (const { name } of charts) {
    const part = tools.find((tool) => tool.name === name);
    assert.equal(part?.status, 'completed', name);
    assert.ok(part.canonicalText?.trim(), `${name} keeps its canonical text`);
    assert.equal(getAgentToolText(part), part.canonicalText, `${name} falls back to text, never raw JSON`);
  }
  assert.equal(tools.find((tool) => tool.name === AGENT_TOOL_SEARCH_TOOL)?.canonicalText, undefined, 'only charts and calculations carry canonical text');
});
