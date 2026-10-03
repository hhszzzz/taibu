import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareDirectChat, prepareManagedChat, resolveManagedChat } from '../lib/server/chat/use-case';
import type {
  ChatActor,
  ChatPreparationInput,
  ChatPromptContext,
  DirectChatOperations,
  ManagedChatOperations,
} from '../lib/server/chat/contracts';

beforeEach((t) => {
  assert.ok('mock' in t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
});

const actor: ChatActor = { userId: 'user-1', creditPolicy: 'charge' };
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
  fallbackPersonality: 'general',
  systemPrompt: 'system prompt',
  promptKnowledgeBases: [],
};

function fixture() {
  const events: string[] = [];
  const operations: ManagedChatOperations = {
    defaultModelId: '',
    resolveModel: async (modelId) => {
      events.push(`model:${modelId}`);
      return { id: 'canonical-model', allowedMemberships: ['free', 'plus', 'pro'], reasoningMemberships: ['plus', 'pro'] };
    },
    loadAccount: async () => {
      events.push('account');
      return { ok: true, value: { effectiveMembership: 'free', hasCredits: true } };
    },
    deductCredit: async () => { events.push('debit'); return { ok: true }; },
    checkRateLimit: async () => { events.push('rate-limit'); return true; },
    refundRateLimitFailure: async () => { events.push('rate-refund'); return true; },
    buildPrompt: async () => { events.push('prompt'); return prompt; },
    refundPromptFailure: async () => { events.push('refund'); },
  };
  const directOperations: DirectChatOperations = {
    defaultModelId: '',
    checkRateLimit: async () => { events.push('rate-limit'); return true; },
    loadAccount: operations.loadAccount,
    buildPrompt: operations.buildPrompt,
  };
  return { events, operations, directOperations };
}

test('managed preparation preserves model/account/debit/limit/prompt ordering and reasoning downgrade', async () => {
  const { events, operations } = fixture();
  const result = await prepareManagedChat(actor, input, operations);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.requestedModelId, 'canonical-model');
  assert.equal(result.value.reasoningEnabled, false);
  assert.equal(result.value.creditDeducted, true);
  assert.equal(result.value.systemPrompt, prompt.systemPrompt);
  assert.deepEqual(events, ['model:requested-model', 'account', 'debit', 'rate-limit', 'prompt']);
  assert.equal('accessTokenForKB' in result.value, false);
  assert.equal('supabase' in result.value, false);
});

test('membership denial wins over insufficient balance and never debits', async () => {
  const { events, operations } = fixture();
  operations.resolveModel = async () => ({ id: 'pro-model', allowedMemberships: ['pro'], reasoningMemberships: ['pro'] });
  operations.loadAccount = async () => ({ ok: true, value: { effectiveMembership: 'free', hasCredits: false } });
  assert.deepEqual(await prepareManagedChat(actor, input, operations), { ok: false, error: { kind: 'membership-denied' } });
  assert.deepEqual(events, []);
});

test('insufficient balance is rejected before debit and prompt assembly', async () => {
  const { events, operations } = fixture();
  operations.loadAccount = async () => ({ ok: true, value: { effectiveMembership: 'free', hasCredits: false } });
  assert.deepEqual(await prepareManagedChat(actor, input, operations), { ok: false, error: { kind: 'insufficient-credits' } });
  assert.deepEqual(events, ['model:requested-model']);
});

for (const [reason, kind] of [
  ['insufficient_credits', 'insufficient-credits'],
  ['deduction_failed', 'deduction-failed'],
] as const) {
  test(`deduction rejection ${reason} does not build prompts or refund an uncharged request`, async () => {
    const { events, operations } = fixture();
    operations.deductCredit = async () => { events.push('debit'); return { ok: false, reason }; };
    assert.deepEqual(await prepareManagedChat(actor, input, operations), { ok: false, error: { kind } });
    assert.deepEqual(events, ['model:requested-model', 'account', 'debit']);
  });
}

test('prompt failure refunds the successful precharge exactly once and rethrows the original error', async () => {
  const { events, operations } = fixture();
  const failure = new Error('prompt failed');
  operations.buildPrompt = async () => { events.push('prompt'); throw failure; };
  await assert.rejects(prepareManagedChat(actor, input, operations), (error) => error === failure);
  assert.deepEqual(events, ['model:requested-model', 'account', 'debit', 'rate-limit', 'prompt', 'refund']);
});

test('prompt refund failure is not retried', async () => {
  const { events, operations } = fixture();
  const refundFailure = new Error('refund failed');
  operations.buildPrompt = async () => { throw new Error('prompt failed'); };
  operations.refundPromptFailure = async () => { events.push('refund'); throw refundFailure; };
  await assert.rejects(prepareManagedChat(actor, input, operations), (error) => error === refundFailure);
  assert.deepEqual(events, ['model:requested-model', 'account', 'debit', 'rate-limit', 'refund']);
});

test('request flags cannot grant bypass to a normal actor', async () => {
  const { events, operations } = fixture();
  const untrustedInput = { ...input, skipCreditCheck: true, internalSecret: 'claimed-secret' };
  const result = await prepareManagedChat(actor, untrustedInput, operations);
  assert.equal(result.ok && result.value.canSkipCredit, false);
  assert.deepEqual(events, ['model:requested-model', 'account', 'debit', 'rate-limit', 'prompt']);
});

test('trusted anonymous bypass skips account and debit, but retains free-tier model admission', async () => {
  const { events, operations } = fixture();
  const trustedActor: ChatActor = { userId: null, creditPolicy: 'trusted-bypass' };
  const result = await prepareManagedChat(trustedActor, input, operations);
  assert.equal(result.ok && result.value.creditDeducted, false);
  assert.equal(result.ok && result.value.canSkipCredit, true);
  assert.deepEqual(events, ['model:requested-model', 'prompt']);
  operations.resolveModel = async () => ({ id: 'pro-model', allowedMemberships: ['pro'], reasoningMemberships: ['pro'] });
  assert.deepEqual(await prepareManagedChat(trustedActor, input, operations), { ok: false, error: { kind: 'membership-denied' } });
});

test('trusted user bypass still loads membership, enables allowed reasoning, and does not refund prompt failure', async () => {
  const { events, operations } = fixture();
  operations.loadAccount = async () => {
    events.push('account');
    return { ok: true, value: { effectiveMembership: 'pro', hasCredits: false } };
  };
  operations.buildPrompt = async (resolved) => {
    events.push('prompt');
    assert.equal(resolved.reasoningEnabled, true);
    throw new Error('prompt failed');
  };
  await assert.rejects(prepareManagedChat({ userId: 'user-1', creditPolicy: 'trusted-bypass' }, input, operations), /prompt failed/);
  assert.deepEqual(events, ['model:requested-model', 'account', 'prompt']);
});

test('resolution alone debits then limits without assembling prompts and preserves default model lookup', async () => {
  const { events, operations } = fixture();
  const result = await resolveManagedChat(actor, { ...input, model: ' ', stream: false }, operations);
  assert.equal(result.ok && result.value.creditDeducted, true);
  assert.deepEqual(events, ['model:', 'account', 'debit', 'rate-limit']);
});

for (const limiter of ['deny', 'throw'] as const) {
  for (const refund of ['success', 'failure', 'throw'] as const) {
    test(`managed limiter ${limiter}, refund ${refund}: one compensation and no prompt`, async () => {
      const { events, operations } = fixture();
      operations.checkRateLimit = async () => {
        events.push('rate-limit');
        if (limiter === 'throw') throw new Error('limiter failed');
        return false;
      };
      operations.refundRateLimitFailure = async () => {
        events.push('rate-refund');
        if (refund === 'throw') throw new Error('refund failed');
        return refund === 'success';
      };
      const expectedKind = refund !== 'success'
        ? 'rate-limit-refund-failed'
        : limiter === 'deny' ? 'rate-limited' : 'rate-limit-failed';
      assert.deepEqual(await prepareManagedChat(actor, input, operations), {
        ok: false, error: { kind: expectedKind },
      });
      assert.deepEqual(events, ['model:requested-model', 'account', 'debit', 'rate-limit', 'rate-refund']);
    });
  }
}

test('invalid model and account failure stop preparation before debit or limit', async () => {
  const { events, operations } = fixture();
  operations.resolveModel = async () => null;
  assert.deepEqual(await prepareManagedChat(actor, input, operations), { ok: false, error: { kind: 'invalid-model' } });
  operations.resolveModel = async () => ({ id: 'model', allowedMemberships: ['free'], reasoningMemberships: [] });
  const failure = { ok: false as const, error: { kind: 'account-unavailable' as const, message: 'unavailable', code: 'USER_QUERY_FAILED' } };
  operations.loadAccount = async () => failure;
  assert.deepEqual(await prepareManagedChat(actor, input, operations), failure);
  assert.deepEqual(events, []);
});

test('direct preparation validates account before rate limit, without model check or debit', async () => {
  const { events, directOperations } = fixture();
  directOperations.loadAccount = async () => {
    events.push('account');
    return { ok: true, value: { effectiveMembership: 'free', hasCredits: false } };
  };
  const result = await prepareDirectChat({ userId: 'user-1' }, input, directOperations);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.requestedModelId, 'requested-model');
  assert.equal(result.value.reasoningEnabled, true);
  assert.equal(result.value.creditDeducted, false);
  assert.equal(result.value.canSkipCredit, true);
  assert.deepEqual(events, ['account', 'rate-limit', 'prompt']);
});

test('direct rate-limit rejection follows account validation and never assembles prompts', async () => {
  const { events, directOperations } = fixture();
  directOperations.checkRateLimit = async () => { events.push('rate-limit'); return false; };
  assert.deepEqual(await prepareDirectChat({ userId: 'user-1' }, input, directOperations), { ok: false, error: { kind: 'rate-limited' } });
  assert.deepEqual(events, ['account', 'rate-limit']);
});

test('direct account failure never consumes a rate slot', async () => {
  const { events, directOperations } = fixture();
  const failure = { ok: false as const, error: { kind: 'account-unavailable' as const, message: 'unavailable', code: 'USER_QUERY_FAILED' } };
  directOperations.loadAccount = async () => { events.push('account'); return failure; };
  assert.deepEqual(await prepareDirectChat({ userId: 'user-1' }, input, directOperations), failure);
  assert.deepEqual(events, ['account']);
});

test('direct limiter failure has no debit or refund operation', async () => {
  const { events, directOperations } = fixture();
  directOperations.checkRateLimit = async () => { events.push('rate-limit'); throw new Error('direct limiter failed'); };
  await assert.rejects(prepareDirectChat({ userId: 'user-1' }, input, directOperations), /direct limiter failed/);
  assert.deepEqual(events, ['account', 'rate-limit']);
});

test('direct prompt failure does not have a debit or refund operation', async () => {
  const { events, directOperations } = fixture();
  directOperations.buildPrompt = async () => { events.push('prompt'); throw new Error('direct prompt failed'); };
  await assert.rejects(prepareDirectChat({ userId: 'user-1' }, input, directOperations), /direct prompt failed/);
  assert.deepEqual(events, ['account', 'rate-limit', 'prompt']);
});
