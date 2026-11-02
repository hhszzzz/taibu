import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BYOK_POLICY, ByokInputError, ByokRequestError, byokAddressError, byokComposerEffort, byokEffortLevels, byokEndpoint,
  byokFailureFromMessage, byokKeyHint, byokRef, byokThinking, clampByokLevel, defaultByokEffort, formatByokError,
  inferByokProtocol, isByokRef, isReservedModelKey, normalizeByokAddress, normalizeByokPolicy, parseByokConnectionInput,
  parseByokPolicy, parseByokRef, toggleV1Address, usesServerKey,
} from '../lib/byok/config';
import { parseModelInput } from '../lib/admin/ai-catalog';

const ID = '00000000-0000-4000-8000-0000000000b1';

test('own models are named byok:<row id>, and platform keys may not take that prefix', () => {
  assert.equal(byokRef(ID), `byok:${ID}`);
  assert.equal(parseByokRef(`byok:${ID.toUpperCase()}`), ID, 'the row id is read case-insensitively');
  for (const value of ['deepseek-chat', 'byok:not-a-uuid', `custom:${ID}`, `byok:${ID}x`, null, 3]) assert.equal(isByokRef(value), false, String(value));
  assert.equal(isReservedModelKey(`byok:${ID}`), true);
  assert.equal(isReservedModelKey('custom:gpt-4o'), true);
  assert.equal(isReservedModelKey('gpt-4o'), false);
  const admin = { modelKey: 'byok:mine', displayName: '模型', vendor: 'openai', usageType: 'chat', sources: [] };
  assert.match((parseModelInput(admin) as { error: string }).error, /byok:/u, 'the admin catalog refuses a reserved key');
});

test('the policy fills defaults, and an administrator\'s edit is checked field by field', () => {
  assert.deepEqual(normalizeByokPolicy(null), DEFAULT_BYOK_POLICY);
  assert.deepEqual(normalizeByokPolicy({ allowServerKeys: false, maxConnections: '3', maxModelsPerConnection: 999 }),
    { allowServerKeys: false, maxConnections: 3, maxModelsPerConnection: DEFAULT_BYOK_POLICY.maxModelsPerConnection });
  assert.deepEqual(parseByokPolicy({ allowServerKeys: true, maxConnections: 5, maxModelsPerConnection: '20' }),
    { allowServerKeys: true, maxConnections: 5, maxModelsPerConnection: 20 });
  for (const bad of [null, [], { allowServerKeys: 'yes', maxConnections: 5, maxModelsPerConnection: 5 },
    { allowServerKeys: true, maxConnections: 0, maxModelsPerConnection: 5 }, { allowServerKeys: true, maxConnections: 5, maxModelsPerConnection: 1.5 }]) {
    assert.throws(() => parseByokPolicy(bad), ByokInputError, JSON.stringify(bad));
  }
  assert.equal(usesServerKey({ keyHint: 'sk-…abcd' }, { allowServerKeys: true }), true);
  assert.equal(usesServerKey({ keyHint: 'sk-…abcd' }, { allowServerKeys: false }), false, 'a stored key stops working when switched off');
  assert.equal(usesServerKey({ keyHint: null }, { allowServerKeys: true }), false);
});

test('an OpenAI-compatible address gets /v1 unless it has a version or is a full request URL', () => {
  const chat = (address: string) => byokEndpoint('openai', address).chatUrl;
  assert.equal(chat('https://api.deepseek.com'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(chat('https://api.deepseek.com/'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(chat('https://open.bigmodel.cn/api/paas/v4'), 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
  assert.equal(chat('https://generativelanguage.googleapis.com/v1beta/openai'), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(chat('https://relay.example/custom/chat/completions'), 'https://relay.example/custom/chat/completions', 'a full address is used as is');
  const endpoint = byokEndpoint('openai', 'https://api.openai.com/v1');
  assert.deepEqual([endpoint.modelsUrl, endpoint.imagesUrl], ['https://api.openai.com/v1/models', 'https://api.openai.com/v1/images/generations']);

  const anthropic = byokEndpoint('anthropic', 'https://api.anthropic.com/v1/messages');
  assert.deepEqual([anthropic.sdkBase, anthropic.chatUrl, anthropic.modelsUrl, anthropic.imagesUrl],
    ['https://api.anthropic.com', 'https://api.anthropic.com/v1/messages', 'https://api.anthropic.com/v1/models', null]);
  assert.equal(byokEndpoint('anthropic', 'https://relay.example/claude/v1').chatUrl, 'https://relay.example/claude/v1/messages');

  assert.equal(toggleV1Address('https://relay.example'), 'https://relay.example/chat/completions', '/v1 removed');
  assert.equal(toggleV1Address('https://relay.example/chat/completions'), 'https://relay.example/v1/chat/completions', '/v1 added');
  assert.equal(toggleV1Address('https://open.bigmodel.cn/api/paas/v4'), null, 'another version is left alone');
  assert.equal(inferByokProtocol('https://api.anthropic.com/v1'), 'anthropic');
  assert.equal(inferByokProtocol('https://api.deepseek.com'), null);
});

test('an address is saved only as a plain public HTTPS URL', () => {
  assert.equal(byokAddressError(' https://api.deepseek.com/v1/ '), null);
  assert.equal(normalizeByokAddress(' https://api.deepseek.com/v1/ '), 'https://api.deepseek.com/v1');
  for (const [address, message] of [
    ['', /请填写/u], ['not a url', /格式无效/u], ['http://api.deepseek.com', /HTTPS/u],
    ['https://user:pass@api.example.com', /认证信息/u], ['https://api.example.com/v1?key=1', /查询参数/u], [`https://a.example/${'x'.repeat(300)}`, /过长/u],
  ] as const) assert.match(byokAddressError(address) ?? '', message, address);
  assert.equal(byokKeyHint('sk-1234567890abcd'), 'sk-…abcd');
  assert.equal(byokKeyHint('short'), '…rt', 'a short key shows less');
});

test('effort: every level when unknown, medium first, a missing level moves to the nearest, and the composer reads the default', () => {
  assert.deepEqual(byokEffortLevels([]), ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(byokEffortLevels(['high', 'low']), ['low', 'high'], 'known levels keep their order');
  assert.equal(defaultByokEffort([]), 'medium');
  assert.equal(defaultByokEffort(['low', 'high']), 'high', 'without medium, the highest offered');
  assert.equal(clampByokLevel(['low', 'high'], 'medium'), 'high', 'upwards first');
  assert.equal(clampByokLevel(['low', 'medium'], 'max'), 'medium', 'then downwards');
  assert.deepEqual(byokThinking(false, 'high'), { mode: 'off' });
  assert.deepEqual(byokThinking(true, null), { mode: 'auto' }, 'thinking on without a level is the model default');
  assert.deepEqual(byokThinking(true, 'xhigh', ['low', 'high']), { mode: 'level', level: 'high' });
  assert.deepEqual(byokComposerEffort('off'), { reasoning: false, reasoningEffort: null });
  assert.deepEqual(byokComposerEffort('auto'), { reasoning: true, reasoningEffort: null });
  assert.deepEqual(byokComposerEffort('high'), { reasoning: true, reasoningEffort: 'high' });
});

test('a provider failure shows its status and text, with a hint that fits where the call came from', () => {
  assert.deepEqual(byokFailureFromMessage('401 Incorrect API key provided'), { status: 401, text: 'Incorrect API key provided' });
  assert.deepEqual(byokFailureFromMessage('404: model not found'), { status: 404, text: 'model not found' });
  assert.equal(byokFailureFromMessage('Connection error.').kind, 'network');
  assert.equal(byokFailureFromMessage('Request timed out.').kind, 'timeout');
  assert.equal(byokFailureFromMessage('AGENT_PRIVATE_ADDRESS_BLOCKED').kind, 'private');

  assert.equal(formatByokError({ status: 401, text: '{"error":{"message":"bad key"}}' }), 'HTTP 401 · {"error":{"message":"bad key"}}\nKey 无效、已过期，或没有这个模型的权限。');
  assert.match(formatByokError({ kind: 'network', text: 'Failed to fetch' }, { browser: true }), /CORS[\s\S]*保存到本站/u, 'a browser failure suggests storing the key');
  assert.doesNotMatch(formatByokError({ kind: 'network', text: 'fetch failed' }), /CORS/u);
  assert.match(formatByokError({ status: 400, text: 'unknown parameter: reasoning_effort' }), /模型默认/u);
  const long = formatByokError({ status: 500, text: 'x'.repeat(2000) });
  assert.ok(long.length < 700, 'the upstream text is cut');
  const error = new ByokRequestError({ status: 429, text: 'quota' });
  assert.match(error.message, /^HTTP 429 · quota\n/u);
  assert.equal(error.failure.status, 429);
});

test('a saved connection is checked like the settings page checks it', () => {
  const input = parseByokConnectionInput({
    name: ' DeepSeek ', protocol: 'openai', baseUrl: 'https://api.deepseek.com/', key: { store: true, value: ' sk-abc ' },
    models: [
      { modelId: 'deepseek-chat', thinkingLevels: ['high', 'low'], defaultEffort: 'medium', contextWindow: '128000' },
      { modelId: 'gpt-image-1', usage: 'image', supportsVision: true, thinkingLevels: ['high'], defaultEffort: 'high', contextWindow: 5 },
    ],
  }, { partial: false, maxModels: 50 });
  assert.equal(input.name, 'DeepSeek');
  assert.equal(input.baseUrl, 'https://api.deepseek.com');
  assert.deepEqual(input.key, { store: true, value: 'sk-abc' });
  assert.deepEqual(input.models[0], {
    modelId: 'deepseek-chat', displayName: 'deepseek-chat', usage: 'chat', supportsVision: false,
    thinkingLevels: ['low', 'high'], defaultEffort: 'high', contextWindow: 128000, maxOutput: null,
  }, 'an unlisted default level moves to the nearest listed one');
  assert.deepEqual(input.models[1], {
    modelId: 'gpt-image-1', displayName: 'gpt-image-1', usage: 'image', supportsVision: false, thinkingLevels: [], defaultEffort: 'auto', contextWindow: null, maxOutput: null,
  }, 'an image model carries no chat settings');
  assert.deepEqual(parseByokConnectionInput({ name: '改名' }, { partial: true, maxModels: 50 }), { name: '改名' }, 'an edit sends only what changed');

  const base = { name: 'x', protocol: 'openai', baseUrl: 'https://api.example.com', key: { store: false }, models: [] };
  for (const [patch, message] of [
    [{ protocol: 'gemini' }, /协议/u],
    [{ baseUrl: 'http://api.example.com' }, /HTTPS/u],
    [{ key: { store: true, value: 'has space' } }, /格式无效/u],
    [{ key: { store: 'yes' } }, /Key 设置/u],
    [{ protocol: 'anthropic', models: [{ modelId: 'gpt-image-1', usage: 'image' }] }, /Anthropic/u],
    [{ models: [{ modelId: 'a' }, { modelId: 'a' }] }, /重复/u],
    [{ models: [{ modelId: 'a', defaultEffort: 'turbo' }] }, /默认努力程度/u],
    [{ models: [{ modelId: 'a', contextWindow: 10 }] }, /上下文/u],
    [{ models: [{ modelId: 'a', id: 'not-a-uuid' }] }, /模型标识/u],
    [{ models: Array.from({ length: 3 }, (_, index) => ({ modelId: `m${index}` })) }, /最多 2/u],
  ] as const) {
    assert.throws(() => parseByokConnectionInput({ ...base, ...patch }, { partial: false, maxModels: 2 }), message, JSON.stringify(patch));
  }
});
