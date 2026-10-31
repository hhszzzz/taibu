import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManagedAnalysisCompletion,
  createRequestObservation,
  type RequestObservationEvent,
  persistDirectAnalysis,
  prepareAnalysis,
  prepareAdmittedAnalysis,
  runManagedAnalysis,
} from '../lib/server/analysis';

for (const reason of ['limited', 'rate-error', 'prompt-error'] as const) {
  test(`admission ${reason} stops before prompts and reports no billing`, async () => {
    const events: string[] = [];
    const error = new Error(reason);
    const result = await prepareAdmittedAnalysis({
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
    assert.equal(result.error, reason === 'limited' ? undefined : error);
    assert.deepEqual(events, reason === 'prompt-error' ? ['limit', 'prompt'] : ['limit']);
  });
}

test('admitted preparation preserves the prepared DTO and never charges a successful admission', async () => {
  const events: string[] = [];
  const value = { actor: { userId: 'user-1' }, input: { id: 'reading-1' }, prompts: { systemPrompt: 'system', userPrompt: 'user' } };
  const result = await prepareAdmittedAnalysis({
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
    status: 'saved', generation: 'completed', persistence: 'saved',
    output: { content: 'analysis', reasoning: 'reason' }, conversationId: 'conversation-1',
  });
  assert.deepEqual(calls, ['save:analysis']);
});

for (const mode of ['text', 'stream'] as const) {
  test(`managed ${mode} treats reasoning-only output as empty without saving`, async () => {
    const complete = createManagedAnalysisCompletion(mode, {
      persist: async () => { assert.fail('empty output must not be saved'); },
      isPersistenceError: () => false,
    });
    const event = { kind: 'output' as const, output: { content: ' \n ', reasoning: 'reason only' } };
    const [outcome, repeated] = await Promise.all([complete(event), complete(event)]);
    assert.equal(outcome, repeated);
    assert.deepEqual(outcome, {
      status: 'failed', generation: 'empty', persistence: 'not-needed', failure: 'empty', error: undefined,
    });
  });
}

test('managed vision preserves empty persistence and undefined text reasoning remains unchanged', async () => {
  const outputs: unknown[] = [];
  const complete = createManagedAnalysisCompletion('vision', {
    persist: async (output) => { outputs.push(output); return 'vision-1'; },
    isPersistenceError: () => false,
  });
  const output = { content: '', reasoning: undefined };
  const outcome = await runManagedAnalysis(async () => output, complete);
  assert.deepEqual(outputs, [output]);
  assert.deepEqual(outcome, {
    status: 'saved', generation: 'empty', persistence: 'saved', output, conversationId: 'vision-1',
  });
});

test('managed explicit abort does not persist partial output, even after late completion', async () => {
  const complete = createManagedAnalysisCompletion('stream', {
    persist: async () => { assert.fail('aborted output must not be saved'); },
    isPersistenceError: () => false,
  });
  const outcome = await complete({ kind: 'aborted' });
  assert.deepEqual(outcome, { status: 'aborted', generation: 'aborted', persistence: 'not-needed' });
  assert.equal(await complete({ kind: 'output', output: { content: 'partial' } }), outcome);
});

test('managed inference failure preserves the error for transport mapping without saving', async () => {
  const error = new Error('provider unavailable');
  const complete = createManagedAnalysisCompletion('text', {
    persist: async () => { assert.fail('inference failed'); },
    isPersistenceError: () => false,
  });
  const outcome = await runManagedAnalysis(async () => { throw error; }, complete);
  assert.deepEqual(outcome, {
    status: 'failed', generation: 'failed', persistence: 'not-needed', failure: 'inference', error,
  });
});

for (const [mode, typedError, failure, persistence] of [
  ['text', true, 'persistence', 'failed'],
  ['text', false, 'inference', 'not-needed'],
  ['stream', false, 'inference', 'not-needed'],
] as const) {
  test(`managed ${mode} inference failure classifies ${failure} exactly once`, async () => {
    let writes = 0;
    const error = new Error('save failed');
    const complete = createManagedAnalysisCompletion(mode, {
      persist: async () => { writes += 1; throw error; },
      isPersistenceError: () => typedError,
    });
    const outcome = await complete({ kind: 'inference-failed', error });
    assert.deepEqual(outcome, { status: 'failed', generation: 'failed', persistence, failure, error });
    assert.equal(writes, 0);
  });
}

test('managed persistence failure keeps the output generation and reports the save error', async () => {
  const error = new Error('save failed');
  const complete = createManagedAnalysisCompletion('text', {
    persist: async () => { throw error; },
    isPersistenceError: () => true,
  });
  const outcome = await complete({ kind: 'output', output: { content: 'analysis' } });
  assert.deepEqual(outcome, {
    status: 'failed', generation: 'completed', persistence: 'failed', failure: 'persistence', error,
  });
});

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

test('request observation reports metered persistence failure once without secrets', async () => {
  const events: RequestObservationEvent[] = [];
  let time = 0;
  const observation = createRequestObservation('trusted-id', 'chat', () => ++time, event => { events.push(event); });
  observation.update({ billing: 'metered' });
  const complete = createManagedAnalysisCompletion('text', {
    persist: async () => { throw new Error('PRIVATE_CONTENT'); },
    isPersistenceError: () => true,
    observation,
  });
  const [first, second] = await Promise.all([
    complete({ kind: 'output', output: { content: 'PRIVATE_PROMPT' } }),
    complete({ kind: 'aborted' }),
  ]);
  assert.equal(first, second);
  const terminal = events.filter(event => event.phase === 'terminal');
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].billing, 'metered');
  assert.equal(terminal[0].persistence, 'failed');
  assert.equal(terminal[0].generation, 'completed');
  assert.equal(terminal[0].failure, 'persistence');
  assert.ok(events.every(event => event.requestId === 'trusted-id' && event.source === 'chat' && event.durationMs >= 0));
  assert.ok(!JSON.stringify(events).includes('PRIVATE'));
  assert.deepEqual(events.map(event => event.phase), ['admission', 'persistence', 'terminal']);
});

test('request observation marks empty text output as a failed admission-generating terminal', async () => {
  const events: RequestObservationEvent[] = [];
  let time = 0;
  const observation = createRequestObservation('id', 'face', () => ++time, event => { events.push(event); });
  observation.update({ billing: 'metered' });
  const complete = createManagedAnalysisCompletion('text', {
    persist: async () => { assert.fail('empty output must not be saved'); },
    isPersistenceError: () => false,
    observation,
  });
  await complete({ kind: 'output', output: { content: '' } });
  const terminal = events.at(-1);
  assert.equal(terminal?.phase, 'terminal');
  assert.equal(terminal?.generation, 'empty');
  assert.equal(terminal?.persistence, 'not-needed');
  assert.equal(terminal?.billing, 'metered');
  assert.deepEqual(events.map(event => event.phase), ['admission', 'terminal']);
});

test('observation sink failure never changes completion', async () => {
  const observation = createRequestObservation('id', 'chat', () => 1, () => { throw new Error('logger down'); });
  const complete = createManagedAnalysisCompletion('text', {
    persist: async () => 'conversation',
    isPersistenceError: () => false,
    observation,
  });
  assert.equal((await complete({ kind: 'output', output: { content: 'ok' } })).status, 'saved');
});
