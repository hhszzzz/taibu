import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAgentToolAccess } from '../lib/agent/tools.server';
import { MemoryStore, row } from './helpers/agent-runtime-fixture';

test('knowledge and web tools serve every member; networking still follows the task', async t => {
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  let knowledge: 'enabled' | 'disabled' = 'enabled';
  t.mock.method(settings, 'readFeatureModuleStateFresh', async (featureId: string) => ({
    status: featureId === 'knowledge-base' ? knowledge : 'enabled' as const,
  }));
  for (const name of ['bazi', 'qimen', 'tarot', 'ask_user', 'list_user_data', 'search_knowledge']) {
    await assertAgentToolAccess(new MemoryStore(), row(), name, {});
  }
  knowledge = 'disabled';
  await assert.rejects(assertAgentToolAccess(new MemoryStore(), row(), 'search_knowledge', {}), /知识库功能已关闭/);

  const run = row();
  run.input.webEnabled = true;
  await assertAgentToolAccess(new MemoryStore(), run, 'web_search', {});
  // An MCP tool's server is checked when the tool runs; the task must still have networking on.
  await assertAgentToolAccess(new MemoryStore(), run, 'mcp__web__search', {});
  run.input.webEnabled = false;
  await assert.rejects(assertAgentToolAccess(new MemoryStore(), run, 'web_search', {}), /当前任务/);
  await assert.rejects(assertAgentToolAccess(new MemoryStore(), run, 'mcp__web__search', {}), /没有开启联网/);
});

test('administrator Agent scope switches block tool execution before the provider is called', async t => {
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  t.mock.method(settings, 'readFeatureModuleStateFresh', async (featureId: string) => ({
    status: ['agent-tool:bazi', 'agent-tool:web', 'agent-tool:code', 'agent-tool:plan'].includes(featureId) ? 'disabled' as const : 'enabled' as const,
  }));
  const run = row();

  await assert.rejects(
    assertAgentToolAccess(new MemoryStore(), run, 'bazi', {}),
    /Agent 工具范围已关闭：八字工具/,
  );
  await assert.rejects(
    assertAgentToolAccess(new MemoryStore(), run, 'web_search', {}),
    /Agent 工具范围已关闭：联网与 MCP/,
  );
  // A task that started before the administrator closed a run mode cannot keep using its tool.
  await assert.rejects(
    assertAgentToolAccess(new MemoryStore(), run, 'codemode', {}),
    /Agent 工具范围已关闭：代码模式/,
  );
  await assert.rejects(
    assertAgentToolAccess(new MemoryStore(), run, 'submit_plan', {}),
    /Agent 工具范围已关闭：计划模式/,
  );
});

test('disabling the bazi module also blocks reading saved bazi data', async t => {
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  t.mock.method(settings, 'readFeatureModuleStateFresh', async (featureId: string) => ({
    status: featureId === 'bazi' ? 'disabled' as const : 'enabled' as const,
  }));

  await assert.rejects(
    assertAgentToolAccess(new MemoryStore(), row(), 'read_user_data', { type: 'bazi_chart', id: 'chart-1' }),
    /该资料功能已关闭/,
  );
});

test('the pairing is a bazi tool, and the charts it names are checked as a drilldown\'s are', async t => {
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  let disabled = 'agent-tool:bazi';
  t.mock.method(settings, 'readFeatureModuleStateFresh', async (featureId: string) => ({ status: featureId === disabled ? 'disabled' as const : 'enabled' as const }));
  const birth = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
  await assert.rejects(assertAgentToolAccess(new MemoryStore(), row(), 'bazi_hepan', { a: birth, b: birth }), /Agent 工具范围已关闭：八字工具/);
  disabled = 'bazi';
  await assert.rejects(assertAgentToolAccess(new MemoryStore(), row(), 'bazi_hepan', { a: birth, b: birth }), /该功能已关闭/);
  disabled = '';
  await assertAgentToolAccess(new MemoryStore(), row(), 'bazi_hepan', { a: birth, b: birth });
  // A chart of another conversation or user is not found, on every execution and replay.
  await assert.rejects(assertAgentToolAccess(new MemoryStore(), row(), 'bazi_hepan', { a: birth, b: { reference: 'artifact:00000000-0000-4000-8000-000000000000' } }),
    /命盘不在当前会话中或无权访问/);
});
