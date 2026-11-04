import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareDirectChat, prepareManagedChat, resolveManagedChat } from '../lib/server/chat/use-case';
import type {
  ChatActor,
  ChatModelAccess,
  ChatPreparationInput,
  ChatPromptContext,
  DirectChatOperations,
  ManagedChatOperations,
} from '../lib/server/chat/contracts';

beforeEach((t) => {
  assert.ok('mock' in t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
});

const actor: ChatActor = { userId: 'user-1', billing: 'metered' };
const input: ChatPreparationInput = {
  messages: [{ id: 'm1', role: 'user', content: 'hello', createdAt: '2026-01-01T00:00:00Z' }],
  model: ' requested-model ',
  reasoning: true,
  stream: true,
};
const prompt: ChatPromptContext = {
  sanitizedMessages: input.messages,
  metadata: {
    sources: [],
    kbSearchEnabled: false,
    kbHitCount: 0,
    promptDiagnostics: { modelId: 'canonical-model', layers: [], totalTokens: 0, budgetTotal: 1024, userMessageTokens: 0 },
  },
  systemPrompt: 'system prompt',
  promptKnowledgeBases: [],
};
const PRICED = { input: 1, output: 2, cacheRead: null, cacheWrite: null, image: null };
const model = (overrides: Partial<ChatModelAccess> = {}): ChatModelAccess => ({
  id: 'canonical-model', offered: true, pricing: PRICED, supportsReasoning: false, ...overrides,
});

function fixture() {
  const events: string[] = [];
  const operations: ManagedChatOperations = {
    defaultModelId: '',
    resolveModel: async (modelId) => { events.push(`model:${modelId}`); return model(); },
    admit: async () => { events.push('admit'); return true; },
    checkRateLimit: async () => { events.push('rate-limit'); return true; },
    buildPrompt: async () => { events.push('prompt'); return prompt; },
  };
  const directOperations: DirectChatOperations = {
    defaultModelId: '',
    checkRateLimit: operations.checkRateLimit,
    buildPrompt: operations.buildPrompt,
  };
  return { events, operations, directOperations };
}

test('managed preparation runs model, balance, limit and prompt in order, and charges nothing up front', async () => {
  const { events, operations } = fixture();
  const result = await prepareManagedChat(actor, input, operations);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.requestedModelId, 'canonical-model');
  assert.equal(result.value.reasoningEnabled, false, 'a model without reasoning turns it off');
  assert.equal(result.value.metered, true);
  assert.equal(result.value.systemPrompt, prompt.systemPrompt);
  assert.deepEqual(events, ['model:requested-model', 'admit', 'rate-limit', 'prompt']);
  assert.equal('accessTokenForKB' in result.value, false);
  assert.equal('supabase' in result.value, false);
});

test('reasoning follows the request on a model that supports it, for every member', async () => {
  const { operations } = fixture();
  operations.resolveModel = async () => model({ supportsReasoning: true });
  const on = await prepareManagedChat(actor, input, operations);
  assert.equal(on.ok && on.value.reasoningEnabled, true);
  const off = await prepareManagedChat(actor, { ...input, reasoning: false }, operations);
  assert.equal(off.ok && off.value.reasoningEnabled, false);
});

test('an unpriced model is refused before the balance is read, even for a trusted caller', async () => {
  const { events, operations } = fixture();
  operations.resolveModel = async () => { events.push('model'); return model({ offered: false }); };
  assert.deepEqual(await prepareManagedChat(actor, input, operations), { ok: false, error: { kind: 'model-unpriced' } });
  assert.deepEqual(await prepareManagedChat({ userId: null, billing: 'trusted-bypass' }, input, operations), { ok: false, error: { kind: 'model-unpriced' } });
  assert.deepEqual(events, ['model', 'model']);
});

test('nothing to spend is refused before the rate limit and the prompt', async () => {
  const { events, operations } = fixture();
  operations.admit = async () => { events.push('admit'); return false; };
  assert.deepEqual(await prepareManagedChat(actor, input, operations), { ok: false, error: { kind: 'insufficient-balance' } });
  assert.deepEqual(events, ['model:requested-model', 'admit']);
});

test('an unreadable balance fails closed without consuming a rate slot', async () => {
  const { events, operations } = fixture();
  operations.admit = async () => { events.push('admit'); throw new Error('database down'); };
  assert.deepEqual(await prepareManagedChat(actor, input, operations), { ok: false, error: { kind: 'balance-unavailable' } });
  assert.deepEqual(events, ['model:requested-model', 'admit']);
});

test('the model the balance check sees is the resolved one, so a free model can pass on an empty balance', async () => {
  const { operations } = fixture();
  const seen: ChatModelAccess[] = [];
  operations.resolveModel = async () => model({ id: 'free-model', pricing: { ...PRICED, input: 0, output: 0 } });
  operations.admit = async (resolved) => { seen.push(resolved); return true; };
  assert.equal((await prepareManagedChat(actor, input, operations)).ok, true);
  assert.deepEqual(seen.map(item => [item.id, item.pricing?.input]), [['free-model', 0]]);
});

test('prompt failure is rethrown as is: no charge was taken, so nothing is refunded', async () => {
  const { events, operations } = fixture();
  const failure = new Error('prompt failed');
  operations.buildPrompt = async () => { events.push('prompt'); throw failure; };
  await assert.rejects(prepareManagedChat(actor, input, operations), (error) => error === failure);
  assert.deepEqual(events, ['model:requested-model', 'admit', 'rate-limit', 'prompt']);
});

test('request flags cannot grant bypass to a normal actor', async () => {
  const { events, operations } = fixture();
  const untrustedInput = { ...input, skipBilling: true, internalSecret: 'claimed-secret' };
  const result = await prepareManagedChat(actor, untrustedInput, operations);
  assert.equal(result.ok && result.value.metered, true);
  assert.deepEqual(events, ['model:requested-model', 'admit', 'rate-limit', 'prompt']);
});

test('a trusted caller skips the balance and the rate limit and is never metered', async () => {
  const { events, operations } = fixture();
  for (const trusted of [{ userId: null, billing: 'trusted-bypass' }, { userId: 'user-1', billing: 'trusted-bypass' }] as const) {
    events.length = 0;
    const result = await prepareManagedChat(trusted, input, operations);
    assert.equal(result.ok && result.value.metered, false);
    assert.deepEqual(events, ['model:requested-model', 'prompt']);
  }
});

test('resolution alone checks balance then limit without assembling prompts and preserves default model lookup', async () => {
  const { events, operations } = fixture();
  const result = await resolveManagedChat(actor, { ...input, model: ' ', stream: false }, operations);
  assert.equal(result.ok && result.value.metered, true);
  assert.deepEqual(events, ['model:', 'admit', 'rate-limit']);
});

for (const limiter of ['deny', 'throw'] as const) {
  test(`managed limiter ${limiter} stops before the prompt`, async () => {
    const { events, operations } = fixture();
    operations.checkRateLimit = async () => {
      events.push('rate-limit');
      if (limiter === 'throw') throw new Error('limiter failed');
      return false;
    };
    assert.deepEqual(await prepareManagedChat(actor, input, operations), {
      ok: false, error: { kind: limiter === 'deny' ? 'rate-limited' : 'rate-limit-failed' },
    });
    assert.deepEqual(events, ['model:requested-model', 'admit', 'rate-limit']);
  });
}

test('an invalid model stops preparation before the balance or limit', async () => {
  const { events, operations } = fixture();
  operations.resolveModel = async () => null;
  assert.deepEqual(await prepareManagedChat(actor, input, operations), { ok: false, error: { kind: 'invalid-model' } });
  assert.deepEqual(events, []);
});

test('web search and documents are admitted for every member, alone or together', async () => {
  const attachment = { name: '命书.pdf', text: '正文' };
  for (const request of [
    { ...input, webSearch: true },
    { ...input, webSearch: true, attachment },
    { ...input, attachment },
  ]) {
    const { events, operations, directOperations } = fixture();
    assert.equal((await prepareManagedChat(actor, request, operations)).ok, true);
    assert.deepEqual(events, ['model:requested-model', 'admit', 'rate-limit', 'prompt']);
    events.length = 0;
    assert.equal((await prepareDirectChat({ userId: 'user-1' }, request, directOperations)).ok, true);
    assert.deepEqual(events, ['rate-limit', 'prompt']);
  }
});

test('direct preparation limits then builds the prompt, with no model check and no metering', async () => {
  const { events, directOperations } = fixture();
  const result = await prepareDirectChat({ userId: 'user-1' }, input, directOperations);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.requestedModelId, 'requested-model');
  assert.equal(result.value.reasoningEnabled, true);
  assert.equal(result.value.metered, false);
  assert.deepEqual(events, ['rate-limit', 'prompt']);
});

test('direct rate-limit rejection never assembles prompts', async () => {
  const { events, directOperations } = fixture();
  directOperations.checkRateLimit = async () => { events.push('rate-limit'); return false; };
  assert.deepEqual(await prepareDirectChat({ userId: 'user-1' }, input, directOperations), { ok: false, error: { kind: 'rate-limited' } });
  assert.deepEqual(events, ['rate-limit']);
});

test('direct limiter and prompt failures propagate', async () => {
  const { events, directOperations } = fixture();
  directOperations.checkRateLimit = async () => { events.push('rate-limit'); throw new Error('direct limiter failed'); };
  await assert.rejects(prepareDirectChat({ userId: 'user-1' }, input, directOperations), /direct limiter failed/);
  assert.deepEqual(events, ['rate-limit']);

  const second = fixture();
  second.directOperations.buildPrompt = async () => { second.events.push('prompt'); throw new Error('direct prompt failed'); };
  await assert.rejects(prepareDirectChat({ userId: 'user-1' }, input, second.directOperations), /direct prompt failed/);
  assert.deepEqual(second.events, ['rate-limit', 'prompt']);
});
