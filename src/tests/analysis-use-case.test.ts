import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManagedAnalysisCompletion,
  persistDirectAnalysis,
  prepareAnalysis,
  prepareAdmittedAnalysis,
  runManagedAnalysis,
  type AnalysisRefundReason,
} from '../lib/server/analysis';

for (const reason of ['limited', 'rate-error', 'prompt-error'] as const) {
  for (const refund of ['success', 'failure', 'throw'] as const) {
    test(`charged analysis admission ${reason} with refund ${refund} compensates exactly once`, async () => {
      const events: string[] = [];
      const error = new Error(reason);
      const refundError = new Error('refund failed');
      const result = await prepareAdmittedAnalysis({
        kind: 'charged',
        refund: async () => {
          events.push('refund');
          if (refund === 'throw') throw refundError;
          return refund === 'success';
        },
      }, {
        checkRateLimit: async () => {
          events.push('limit');
          if (reason === 'rate-error') throw error;
          return reason !== 'limited';
        },
        prepare: async () => { events.push('prompt'); throw error; },
      });
      assert.equal(result.ok, false);
      if (result.ok) assert.fail();
      assert.equal(result.reason, reason);
      assert.equal(result.billing, refund === 'success' ? 'refunded' : 'refund-failed');
      assert.equal(result.error, reason === 'limited' ? undefined : error);
      if (refund === 'throw') assert.equal(result.refundError, refundError);
      assert.deepEqual(events, reason === 'prompt-error' ? ['limit', 'prompt', 'refund'] : ['limit', 'refund']);
    });
  }
  test(`direct admission ${reason} never has a refund capability`, async () => {
    const events: string[] = [];
    const result = await prepareAdmittedAnalysis({ kind: 'not-applicable' }, {
      checkRateLimit: async () => {
        events.push('limit');
        if (reason === 'rate-error') throw new Error('limit failed');
        return reason !== 'limited';
      },
      prepare: async () => { events.push('prompt'); throw new Error('prompt failed'); },
    });
    assert.equal(result.ok, false);
    if (result.ok) assert.fail();
    assert.equal(result.reason, reason);
    assert.equal(result.billing, 'not-applicable');
    assert.deepEqual(events, reason === 'prompt-error' ? ['limit', 'prompt'] : ['limit']);
  });
}

test('admitted preparation preserves the prepared DTO and never compensates a successful admission', async () => {
  const events: string[] = [];
  const value = { actor: { userId: 'user-1' }, input: { id: 'reading-1' }, prompts: { systemPrompt: 'system', userPrompt: 'user' } };
  const result = await prepareAdmittedAnalysis({ kind: 'charged', refund: async () => assert.fail('successful admission') }, {
    checkRateLimit: async () => { events.push('limit'); return true; },
    prepare: async () => { events.push('prompt'); return value; },
  });
  assert.deepEqual(result, { ok: true, value });
  assert.deepEqual(events, ['limit', 'prompt']);
});

test('analysis preparation uses authorized values and preserves prompt formatting without mutating builders', async () => {
  const prompts = { systemPrompt: 'system', userPrompt: 'cards' };
  const prepared = await prepareAnalysis({ actor: { userId: 'user-1' }, input: { readingId: 'reading-1' }, context: { detail: 'full' } }, {
    buildPrompts: async (input, context) => {
      assert.equal(input.readingId, 'reading-1');
      assert.equal(context?.detail, 'full');
      return prompts;
    },
    buildOutputContract: () => 'output contract',
  });
  assert.equal(prepared.actor.userId, 'user-1');
  assert.deepEqual(prepared.prompts, { systemPrompt: 'system\n\noutput contract', userPrompt: 'cards' });
  assert.equal(prompts.systemPrompt, 'system');
});

test('managed analysis waits for its injected persistence and saves once across competing completions', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const persistence = new Promise<void>((resolve) => { release = resolve; });
  const complete = createManagedAnalysisCompletion('text', {
    persist: async (output) => {
      calls.push(`save:${output.content}`);
      await persistence;
      return 'conversation-1';
    },
    refund: async () => { calls.push('refund'); return true; },
    isPersistenceError: () => false,
  });
  const pending = complete({ kind: 'output', output: { content: 'analysis', reasoning: 'reason' } });
  const repeated = complete({ kind: 'inference-failed', error: new Error('late error') });
  assert.equal(pending, repeated);
  let finished = false;
  void pending.then(() => { finished = true; });
  await Promise.resolve();
  assert.deepEqual(calls, ['save:analysis']);
  assert.equal(finished, false);
  release();
  assert.deepEqual(await pending, {
    status: 'saved', generation: 'completed', persistence: 'saved', billing: 'charged',
    output: { content: 'analysis', reasoning: 'reason' }, conversationId: 'conversation-1',
  });
  assert.deepEqual(calls, ['save:analysis']);
});

for (const mode of ['text', 'stream'] as const) {
  test(`managed ${mode} treats reasoning-only output as empty and refunds once`, async () => {
    const refunds: AnalysisRefundReason[] = [];
    const complete = createManagedAnalysisCompletion(mode, {
      persist: async () => { assert.fail('empty output must not be saved'); },
      refund: async (reason) => { refunds.push(reason); return true; },
      isPersistenceError: () => false,
    });
    const event = { kind: 'output' as const, output: { content: ' \n ', reasoning: 'reason only' } };
    const [outcome, repeated] = await Promise.all([complete(event), complete(event)]);
    assert.equal(outcome, repeated);
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.generation, 'empty');
    assert.equal(outcome.persistence, 'not-needed');
    assert.equal(outcome.billing, 'refunded');
    assert.deepEqual(refunds, [mode === 'stream' ? 'stream-empty' : 'empty-result']);
  });
}

test('managed vision preserves empty persistence and undefined text reasoning remains unchanged', async () => {
  const outputs: unknown[] = [];
  const complete = createManagedAnalysisCompletion('vision', {
    persist: async (output) => { outputs.push(output); return 'vision-1'; },
    refund: async () => { assert.fail('vision empty output historically does not refund'); },
    isPersistenceError: () => false,
  });
  const output = { content: '', reasoning: undefined };
  const outcome = await runManagedAnalysis(async () => output, complete);
  assert.deepEqual(outputs, [output]);
  assert.equal(outcome.status, 'saved');
  assert.equal(outcome.generation, 'empty');
  assert.equal(outcome.billing, 'charged');
});

test('managed explicit abort does not persist partial output or refund, even after late completion', async () => {
  const complete = createManagedAnalysisCompletion('stream', {
    persist: async () => { assert.fail('aborted output must not be saved'); },
    refund: async () => { assert.fail('explicit abort must not refund'); },
    isPersistenceError: () => false,
  });
  const outcome = await complete({ kind: 'aborted' });
  assert.deepEqual(outcome, { status: 'aborted', generation: 'aborted', persistence: 'not-needed', billing: 'charged' });
  assert.equal(await complete({ kind: 'output', output: { content: 'partial' } }), outcome);
});

test('managed inference failure refunds without saving and preserves the error for transport mapping', async () => {
  const error = new Error('provider unavailable');
  const refunds: AnalysisRefundReason[] = [];
  const complete = createManagedAnalysisCompletion('text', {
    persist: async () => { assert.fail('inference failed'); },
    refund: async (reason) => { refunds.push(reason); return true; },
    isPersistenceError: () => false,
  });
  const outcome = await runManagedAnalysis(async () => { throw error; }, complete);
  assert.equal(outcome.status, 'failed');
  if (outcome.status !== 'failed') assert.fail();
  assert.equal(outcome.failure, 'inference');
  assert.equal(outcome.error, error);
  assert.equal(outcome.persistence, 'not-needed');
  assert.equal(outcome.billing, 'refunded');
  assert.deepEqual(refunds, ['ai-call']);
});

for (const [mode, typedError, expectedReason] of [
  ['text', true, 'persistence'],
  ['text', false, 'ai-call'],
  ['stream', false, 'stream-persist'],
] as const) {
  test(`managed ${mode} persistence failure preserves ${expectedReason} refund classification`, async () => {
    const error = new Error('save failed');
    let writes = 0;
    const refunds: AnalysisRefundReason[] = [];
    const complete = createManagedAnalysisCompletion(mode, {
      persist: async () => { writes += 1; throw error; },
      refund: async (reason) => { refunds.push(reason); return true; },
      isPersistenceError: () => typedError,
    });
    const outcome = await complete({ kind: 'output', output: { content: 'analysis' } });
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') assert.fail();
    assert.equal(outcome.generation, 'completed');
    assert.equal(outcome.persistence, 'failed');
    assert.equal(outcome.billing, 'refunded');
    assert.equal(outcome.error, error);
    assert.equal(writes, 1);
    assert.deepEqual(refunds, [expectedReason]);
  });
}

for (const throws of [false, true]) {
  test(`managed refund ${throws ? 'throw' : 'false'} remains a failed billing terminal without retry`, async () => {
    let refunds = 0;
    const complete = createManagedAnalysisCompletion('text', {
      persist: async () => { assert.fail('empty output'); },
      refund: async () => {
        refunds += 1;
        if (throws) throw new Error('refund unavailable');
        return false;
      },
      isPersistenceError: () => false,
    });
    const event = { kind: 'output' as const, output: { content: '' } };
    assert.equal((await complete(event)).billing, 'refund-failed');
    await complete(event);
    assert.equal(refunds, 1);
  });
}

test('direct submissions have separate success, empty and persistence-failed outcomes without billing', async () => {
  let writes = 0;
  const output = { content: ' browser analysis ', reasoning: 'browser reason' };
  assert.deepEqual(await persistDirectAnalysis(output, async (received) => {
    assert.equal(received, output);
    writes += 1;
    return 'direct-1';
  }), { status: 'saved', persistence: 'saved', billing: 'not-applicable', conversationId: 'direct-1' });
  assert.equal(writes, 1);
  assert.deepEqual(await persistDirectAnalysis({ content: ' ', reasoning: 'only' }, async () => {
    assert.fail('empty direct submissions must not save');
  }), { status: 'empty', persistence: 'not-needed', billing: 'not-applicable' });
  const error = new Error('direct save failed');
  assert.deepEqual(await persistDirectAnalysis(output, async () => { throw error; }), {
    status: 'failed', persistence: 'failed', billing: 'not-applicable', error,
  });
});
