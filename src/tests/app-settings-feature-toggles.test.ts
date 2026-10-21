import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';

type DbContextModule = typeof import('../lib/db/context.server');

async function loadAppSettingsModule() {
  const modulePath = require.resolve('../lib/app-settings');
  delete require.cache[modulePath];
  return await import('../lib/app-settings');
}

function stubSystemDb(t: test.TestContext, tx: (call: number) => unknown) {
  const context = require('../lib/db/context.server') as DbContextModule;
  const original = context.systemDb;
  let calls = 0;
  context.systemDb = (() => createMockScopedDb({
    tx: async () => tx(++calls),
  })) as unknown as typeof context.systemDb;
  t.after(() => {
    context.systemDb = original;
    delete require.cache[require.resolve('../lib/app-settings')];
  });
  return () => calls;
}

test('getFeatureToggles reads every feature row', async (t) => {
  stubSystemDb(t, () => [
    { setting_key: 'feature_disabled:chat', setting_value: true },
    { setting_key: 'feature_disabled:knowledge-base', setting_value: false },
  ]);

  const appSettingsModule = await loadAppSettingsModule();
  const toggles = await appSettingsModule.getFeatureToggles();

  assert.equal(toggles.chat, true);
  assert.equal(toggles['knowledge-base'], false);
});

test('isFeatureModuleEnabled caches single-feature reads', async (t) => {
  let disabled = true;
  const reads = stubSystemDb(t, () => ({ setting_value: disabled }));

  const appSettingsModule = await loadAppSettingsModule();

  assert.equal(await appSettingsModule.isFeatureModuleEnabled('knowledge-base'), false);
  assert.equal(reads(), 1);

  disabled = true;
  const second = await appSettingsModule.isFeatureModuleEnabled('knowledge-base');
  assert.equal(second, false);
  assert.equal(reads(), 1);
});

test('setFeatureToggle refreshes the cached value', async (t) => {
  let disabled = true;
  let writes = 0;
  const reads = stubSystemDb(t, () => ({ setting_value: disabled }));

  const appSettingsModule = await loadAppSettingsModule();
  assert.equal(await appSettingsModule.isFeatureModuleEnabled('chat'), false);
  assert.equal(reads(), 1);

  const context = require('../lib/db/context.server') as DbContextModule;
  const original = context.systemDb;
  context.systemDb = (() => createMockScopedDb({
    tx: async () => {
      reads();
      writes += 1;
      disabled = false;
      return undefined;
    },
  })) as unknown as typeof context.systemDb;
  t.after(() => { context.systemDb = original; });

  assert.equal(await appSettingsModule.setFeatureToggle('chat', false), true);
  assert.equal(writes, 1);
  assert.equal(await appSettingsModule.isFeatureModuleEnabled('chat'), true);
  assert.equal(reads(), 1);
});
