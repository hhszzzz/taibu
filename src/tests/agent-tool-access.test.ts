import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAgentToolAccess } from '../lib/agent/tools.server';
import { MemoryStore, row } from './helpers/agent-runtime-fixture';

test('ordinary Agent tools do not require an account query', async t => {
  const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const account = t.mock.method(credits, 'getUserCreditInfo', async () => { throw new Error('account unavailable'); });
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
  for (const name of ['bazi', 'qimen', 'tarot', 'ask_user', 'list_user_data']) {
    await assertAgentToolAccess(new MemoryStore(), row(), name, {});
  }
  assert.equal(account.mock.callCount(), 0);
  await assert.rejects(assertAgentToolAccess(new MemoryStore(), row(), 'search_knowledge', {}), /account unavailable/);
});

test('membership tools still reject free accounts and disabled task networking', async t => {
  const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const account = t.mock.method(credits, 'getUserCreditInfo', async () => ({ membership: 'free' as const, credits: 0, expiresAt: null }));
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
  const run = row();
  run.input.webEnabled = true;
  for (const name of ['search_knowledge', 'web_search']) {
    await assert.rejects(assertAgentToolAccess(new MemoryStore(), run, name, {}), /当前会员|当前任务/);
  }
  assert.equal(account.mock.callCount(), 2);
  // An MCP tool's server sets the tier, checked when the tool runs; the task must still have networking on.
  await assertAgentToolAccess(new MemoryStore(), run, 'mcp__web__search', {});
  run.input.webEnabled = false;
  await assert.rejects(assertAgentToolAccess(new MemoryStore(), run, 'web_search', {}), /当前任务/);
  await assert.rejects(assertAgentToolAccess(new MemoryStore(), run, 'mcp__web__search', {}), /没有开启联网/);
  assert.equal(account.mock.callCount(), 2, 'disabled networking needs no membership query');
});

test('administrator Agent scope switches block tool execution before the provider is called', async t => {
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  t.mock.method(settings, 'readFeatureModuleStateFresh', async (featureId: string) => ({
    status: featureId === 'agent-tool:bazi' || featureId === 'agent-tool:web' ? 'disabled' as const : 'enabled' as const,
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
