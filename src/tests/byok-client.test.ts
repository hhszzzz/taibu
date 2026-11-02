import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BYOK_POLICY, type ByokCatalog, type ByokConnectionView } from '../lib/byok/config';
import { clearDeviceKeys, readDeviceKeys, setDeviceKey } from '../lib/byok/device-keys';
import { ownModelChoice, ownModels } from '../lib/byok/client';
import {
  applyCapability, connectionBody, connectionDraft, draftChanged, guessUsage, nameFromAddress, newModelDraft, storedKeyMoves, type ByokConnectionDraft,
} from '../lib/byok/draft';
import { matchModelIcon } from '../lib/ai/lobe-icons';

/** A browser's localStorage and events, enough for the device key store. */
function browser(t: TestContext) {
  const storage: Record<string, string> = {};
  let refuse = false;
  Object.defineProperties(storage, {
    getItem: { value: (name: string) => (Object.hasOwn(storage, name) ? storage[name] : null) },
    setItem: { value: (name: string, value: string) => { if (refuse) throw new Error('QuotaExceededError'); storage[name] = String(value); } },
    removeItem: { value: (name: string) => { delete storage[name]; } },
  });
  const events: string[] = [];
  const target = new EventTarget();
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: storage,
    dispatchEvent: (event: Event) => { events.push(event.type); return target.dispatchEvent(event); },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  t.after(() => { (globalThis as { window?: unknown }).window = previous; });
  return { storage, events, refuse: () => { refuse = true; } };
}

const connection = (overrides: Partial<ByokConnectionView> = {}): ByokConnectionView => ({
  id: '00000000-0000-4000-8000-0000000000c1', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', keyHint: null,
  updatedAt: '2026-11-02T00:00:00Z',
  models: [{
    id: '00000000-0000-4000-8000-0000000000b1', ref: 'byok:00000000-0000-4000-8000-0000000000b1', modelId: 'deepseek-chat', displayName: 'DeepSeek Chat',
    usage: 'chat', supportsVision: false, thinkingLevels: [], defaultEffort: 'auto', contextWindow: 128000, maxOutput: 8192,
  }],
  ...overrides,
});

test('device keys are kept per account, removed one by one or all at logout, and survive a broken entry', (t) => {
  const { storage, events, refuse } = browser(t);
  assert.equal(setDeviceKey('user-1', 'conn-a', 'sk-a'), true);
  setDeviceKey('user-1', 'conn-b', 'sk-b');
  setDeviceKey('user-2', 'conn-a', 'sk-other');
  storage['unrelated'] = 'kept';
  assert.deepEqual(readDeviceKeys('user-1'), { 'conn-a': 'sk-a', 'conn-b': 'sk-b' });
  assert.deepEqual(readDeviceKeys('user-2'), { 'conn-a': 'sk-other' }, 'accounts do not see each other\'s keys');
  assert.deepEqual(readDeviceKeys(null), {});
  setDeviceKey('user-1', 'conn-a', null);
  setDeviceKey('user-1', 'conn-b', null);
  assert.equal(storage['taibu:byok-keys:user-1'], undefined, 'the last key leaves no entry behind');
  assert.equal(events.length, 5, 'every change is announced so open menus follow');

  storage['taibu:byok-keys:user-3'] = JSON.stringify({ 'conn-a': 'sk-a', 'conn-b': 7, 'conn-c': '' });
  assert.deepEqual(readDeviceKeys('user-3'), { 'conn-a': 'sk-a' });
  storage['taibu:byok-keys:user-4'] = '{not json';
  assert.deepEqual(readDeviceKeys('user-4'), {});

  clearDeviceKeys();
  assert.deepEqual(Object.keys(storage), ['unrelated'], 'logout removes every account\'s keys and nothing else');
  refuse();
  assert.equal(setDeviceKey('user-1', 'conn-a', 'sk-a'), false, 'a refusing browser is reported');
});

test('an own model runs on the site when its key is stored and allowed, else on this device with the key kept here', () => {
  const catalog: ByokCatalog = {
    policy: DEFAULT_BYOK_POLICY,
    connections: [connection(), connection({ id: '00000000-0000-4000-8000-0000000000c2', keyHint: 'sk-…abcd' })],
  };
  const [browserModel, stored] = ownModels(catalog, { '00000000-0000-4000-8000-0000000000c1': 'sk-device', '00000000-0000-4000-8000-0000000000c2': 'sk-ignored' });
  assert.deepEqual([browserModel.serverKey, browserModel.deviceKey, browserModel.ready], [false, 'sk-device', true]);
  assert.deepEqual([stored.serverKey, stored.deviceKey, stored.ready], [true, null, true], 'a stored key wins; the device copy is not used');
  assert.equal(browserModel.icon, matchModelIcon('deepseek-chat'));
  assert.equal(browserModel.connection.name, 'DeepSeek');

  const [keyless] = ownModels(catalog, {});
  assert.equal(keyless.ready, false, 'without a key on this device the model needs one first');
  const [switchedOff] = ownModels({ ...catalog, policy: { ...DEFAULT_BYOK_POLICY, allowServerKeys: false } }, {}).slice(1);
  assert.deepEqual([switchedOff.serverKey, switchedOff.ready], [false, false], 'a stored key stops working when the administrator turns it off');
  assert.deepEqual(ownModels(null, {}), []);

  const choice = ownModelChoice(browserModel);
  assert.equal(choice.id, browserModel.ref);
  assert.equal(choice.supportsReasoning, true, 'the thinking switch is always offered');
  assert.deepEqual(choice.thinkingLevels, ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], 'unknown levels offer all six');
  assert.equal(choice.defaultThinkingLevel, null, '「模型默认」 has no level');
});

test('the settings draft guesses uses, fills blanks from models.dev and keeps what the member typed', () => {
  assert.equal(guessUsage('gpt-image-1', 'openai'), 'image');
  assert.equal(guessUsage('black-forest-labs/flux-1.1-pro', 'openai'), 'image');
  assert.equal(guessUsage('gemini-2.5-flash-image-preview', 'openai'), 'image');
  assert.equal(guessUsage('deepseek-chat', 'openai'), 'chat');
  assert.equal(guessUsage('gpt-image-1', 'anthropic'), 'chat', 'an Anthropic connection has no image models');

  const capability = { contextWindow: 200000, maxOutput: 64000, vision: true, thinkingLevels: ['low' as const, 'high' as const] };
  const model = newModelDraft('claude-sonnet-4-5', 'chat', capability);
  assert.deepEqual([model.contextWindow, model.maxOutput, model.supportsVision, model.thinkingLevels, model.defaultEffort],
    ['200000', '64000', true, ['low', 'high'], 'high']);
  assert.equal(newModelDraft('mystery', 'chat').defaultEffort, 'medium');
  const image = newModelDraft('gpt-image-1', 'image', capability);
  assert.deepEqual([image.supportsVision, image.thinkingLevels, image.defaultEffort, image.contextWindow], [false, [], 'auto', '']);
  const typed = applyCapability({ ...newModelDraft('x', 'chat'), contextWindow: '32000', defaultEffort: 'off' }, capability);
  assert.deepEqual([typed.contextWindow, typed.maxOutput, typed.defaultEffort], ['32000', '64000', 'off']);

  assert.equal(nameFromAddress('https://api.deepseek.com/v1'), 'deepseek.com');
  assert.equal(nameFromAddress('nope'), '');
});

test('the draft saves what the server accepts, says what is wrong first, and binds a stored key to its host', () => {
  const policy = DEFAULT_BYOK_POLICY;
  const fresh = { ...connectionDraft(null), baseUrl: 'https://api.deepseek.com/', models: [newModelDraft('deepseek-chat', 'chat')] };
  assert.deepEqual(connectionBody(fresh, null, policy), {
    name: 'deepseek.com', protocol: 'openai', baseUrl: 'https://api.deepseek.com', key: { store: false },
    models: [{ modelId: 'deepseek-chat', displayName: 'deepseek-chat', usage: 'chat', supportsVision: false, thinkingLevels: [], defaultEffort: 'medium', contextWindow: null, maxOutput: null }],
  }, 'a blank name comes from the address; the key stays on the device by default');
  assert.deepEqual(connectionBody({ ...fresh, storeOnSite: true, key: ' sk-new ' }, null, policy).key, { store: true, value: 'sk-new' });

  const saved = connection({ keyHint: 'sk-…abcd' });
  const opened = connectionDraft(saved);
  assert.equal(opened.storeOnSite, true);
  assert.equal(opened.models[0].id, saved.models[0].id, 'existing models keep their row, so references stay valid');
  assert.equal(draftChanged(opened, saved), false);
  assert.equal(draftChanged(connectionDraft(saved), saved), false, 'a reopened editor is not dirty');
  assert.deepEqual(connectionBody(opened, saved, policy).key, { store: true }, 'an empty key keeps the stored one');
  const moved = { ...opened, baseUrl: 'https://relay.example/v1' };
  assert.equal(storedKeyMoves(moved, saved), true);
  assert.equal(storedKeyMoves({ ...opened, baseUrl: 'https://api.deepseek.com/v1' }, saved), false, 'a new path on the same host keeps the key');
  assert.equal(draftChanged(moved, saved), true);

  const refused: Array<[ByokConnectionDraft, RegExp]> = [
    [{ ...fresh, baseUrl: '' }, /请填写连接名称/u],
    [{ ...fresh, baseUrl: 'http://api.deepseek.com' }, /HTTPS/u],
    [{ ...fresh, key: 'has space' }, /格式无效/u],
    [{ ...fresh, storeOnSite: true }, /需要填写 API Key/u],
    [moved, /换了域名/u],
    [{ ...fresh, protocol: 'anthropic', models: [newModelDraft('gpt-image-1', 'image')] }, /Anthropic/u],
    [{ ...fresh, models: [newModelDraft('a', 'chat'), newModelDraft('a', 'chat')] }, /重复/u],
    [{ ...fresh, models: [newModelDraft('', 'chat')] }, /模型 ID/u],
    [{ ...fresh, models: [{ ...newModelDraft('a', 'chat'), contextWindow: '12' }] }, /上下文/u],
  ];
  for (const [draft, message] of refused) {
    assert.throws(() => connectionBody(draft, draft === moved ? saved : null, policy), message, JSON.stringify(draft).slice(0, 80));
  }
  assert.throws(() => connectionBody({ ...fresh, storeOnSite: true, key: 'sk-x' }, null, { ...policy, allowServerKeys: false }), /管理员已关闭/u);
  assert.throws(() => connectionBody({ ...fresh, models: [newModelDraft('a', 'chat'), newModelDraft('b', 'chat')] }, null, { ...policy, maxModelsPerConnection: 1 }), /最多 1/u);
  assert.deepEqual(connectionBody({ ...fresh, models: [{ ...newModelDraft('gpt-image-1', 'image'), supportsVision: true, contextWindow: '5' }] }, null, policy).models[0],
    { modelId: 'gpt-image-1', displayName: 'gpt-image-1', usage: 'image', supportsVision: false, thinkingLevels: [], defaultEffort: 'auto', contextWindow: null, maxOutput: null },
    'an image model drops chat settings instead of failing on them');
});
