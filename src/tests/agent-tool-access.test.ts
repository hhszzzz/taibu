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
  for (const name of ['search_knowledge', 'web_search', 'mcp__web__search']) {
    await assert.rejects(assertAgentToolAccess(new MemoryStore(), run, name, {}), /当前会员|当前任务/);
  }
  assert.equal(account.mock.callCount(), 3);
  run.input.webEnabled = false;
  await assert.rejects(assertAgentToolAccess(new MemoryStore(), run, 'web_search', {}), /当前任务/);
  assert.equal(account.mock.callCount(), 3, 'disabled networking needs no membership query');
});
