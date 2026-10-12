import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { listToolDefinitions } from 'taibu-core/mcp';
import type { JsonObject } from '@earendil-works/pi-ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { AgentRunRow } from '../lib/agent/store.server';
import { AGENT_CHART_NAMES, getAgentToolFamily, isAgentChartTool, projectsAgentCanonicalText } from '../lib/agent/tool-catalog';
import { getAgentToolText, type AgentToolPart } from '../lib/agent/tool-presentation';
import { createAgentTools } from '../lib/agent/tools.server';
import { createParallelExtension } from '../lib/agent/parallel.server';
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
  for (const definition of listToolDefinitions())
    assert.ok(['chart', 'calculation'].includes(getAgentToolFamily(definition.name)), definition.name);
  const previous = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = randomUUID();
  try {
    const run = row();
    run.input.webEnabled = true;
    run.input.memoryEnabled = true;
    const tools = await createAgentTools(new MemoryStore(), run, run.checkpoint);
    const parallel = createParallelExtension([], () => { throw new Error('the harness is not opened in this test'); });
    const names = [...tools.map((tool) => tool.name), ...(parallel.tools ?? []).map((tool) => tool.name)];
    assert.ok(names.includes('web_search') && names.includes('remember_user_fact') && names.includes('parallel_analysis'));
    for (const name of names) assert.notEqual(getAgentToolFamily(name), 'other', `${name} needs a family in tool-catalog.ts`);
  } finally {
    if (previous === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous;
  }
  assert.equal(getAgentToolFamily('mcp__archive__search'), 'external');
  assert.equal(getAgentToolFamily('focus_chart'), 'chart');
  for (const name of ['bazi_dayun', 'bazi_pillars_resolve', 'ziwei_horoscope', 'ziwei_flying_star', 'inspect_chart', 'read_user_data'])
    assert.equal(projectsAgentCanonicalText(name), true, name);
  for (const name of ['focus_chart', 'web_search', 'todo_write', 'mcp__archive__search'])
    assert.equal(projectsAgentCanonicalText(name), false, `${name} returns structured data, not canonical text`);
  for (const name of ['unknown', '__proto__', 'constructor', 'toString', '']) {
    assert.equal(getAgentToolFamily(name), 'other', JSON.stringify(name));
    assert.equal(isAgentChartTool(name), false);
    assert.equal(projectsAgentCanonicalText(name), false);
  }
});

test('the projection keeps canonical text on every Core chart and calculation for text fallbacks', async () => {
  const definitions = listToolDefinitions();
  const calculations = definitions.filter(definition => getAgentToolFamily(definition.name) === 'calculation').map(definition => definition.name);
  assert.deepEqual(calculations.sort(), ['bazi_dayun', 'bazi_pillars_resolve', 'ziwei_flying_star', 'ziwei_horoscope']);
  const charts = [...Object.keys(AGENT_CHART_NAMES), ...calculations].map((name) => {
    const args = { ...(definitions.find((definition) => definition.name === name)!.inputSchema.examples![0] as Record<string, unknown>) };
    // Agent seeds come from the task and call; explicit seeds are blocked by policy.
    delete args.seed;
    delete args.seedScope;
    if (name === 'astrology') Object.assign(args, { latitude: 31.2304, longitude: 121.4737, timezone: 'Asia/Shanghai' });
    return { name, args: args as JsonObject };
  });
  const store = new MemoryStore(), run = row();
  const streamFn = scripted((index) => {
    if (index < charts.length) return [{ type: 'toolCall', id: `chart-${index}`, name: charts[index].name, arguments: charts[index].args }];
    if (index === charts.length) return [{ type: 'toolCall', id: 'select', name: 'select_final_artifacts', arguments: { artifactIds: [] } }];
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
  assert.equal(tools.find((tool) => tool.name === 'select_final_artifacts')?.canonicalText, undefined);
});
