import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import type { JsonObject } from '@earendil-works/pi-ai';
import { listToolDefinitions } from 'taibu-core/mcp';
import type { AgentRunRow } from '../lib/agent/store.server';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { config, MemoryStore, row, scripted } from './helpers/agent-runtime-fixture';

beforeEach((t) => {
  assert.ok('mock' in t);
  const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const sdk = require('../lib/ai/providers/ai-sdk-provider') as typeof import('../lib/ai/providers/ai-sdk-provider');
  t.mock.method(credits, 'getUserCreditInfo', async () => ({ membership: 'plus', credits: 10, expiresAt: null }));
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
  t.mock.method(sdk, 'isModelAvailable', () => true);
  t.mock.method(sdk, 'createModelFromConfig', () => new MockLanguageModelV3());
});

const finished = (store: MemoryStore) => store.writes.filter(write => write.name === 'agent_finish_run').at(-1)!;
const bazi = (): JsonObject => ({ ...(listToolDefinitions().find(definition => definition.name === 'bazi')!.inputSchema.examples![0] as JsonObject) });

test('one calculation is selected on its own; the model is not asked again', async () => {
  const store = new MemoryStore(), run = row();
  let rounds = 0;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    rounds = index + 1;
    if (index === 0) return [{ type: 'toolCall', id: 'chart', name: 'bazi', arguments: bazi() }];
    return [{ type: 'text', text: '日主庚金，取财官。' }];
  }) });
  const finish = finished(store);
  assert.equal(finish.args.p_status, 'completed');
  const checkpoint = finish.args.p_checkpoint as AgentRunRow['checkpoint'];
  assert.deepEqual(checkpoint.finalArtifacts, [[...store.drafts.values()][0].id], 'the only calculation is the result');
  assert.equal(checkpoint.finalSelectionMade, true);
  assert.equal(rounds, 2, 'no extra round for the selection');
});

test('several calculations are nudged at most twice, then the task settles without a selection', async () => {
  const store = new MemoryStore(), run = row();
  const prompts: string[] = [];
  let rounds = 0;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    rounds = index + 1;
    if (index === 0) return [{ type: 'toolCall', id: 'first', name: 'bazi', arguments: bazi() }];
    if (index === 1) return [{ type: 'toolCall', id: 'second', name: 'bazi', arguments: { ...bazi(), birthYear: 1991 } }];
    return [{ type: 'text', text: '两种出生时间都已比较。' }];
  }, messages => prompts.push(JSON.stringify(messages))) });
  const finish = finished(store);
  assert.equal(finish.args.p_status, 'completed', 'an answer with no selection still settles');
  const checkpoint = finish.args.p_checkpoint as AgentRunRow['checkpoint'];
  assert.equal(checkpoint.finalSelectionMade, false, 'a new calculation asks for a selection again');
  assert.deepEqual(checkpoint.finalArtifacts, []);
  assert.equal(checkpoint.finalNudges, 2);
  assert.equal(rounds, 5, 'two chart rounds, then an answer after each of two nudges');
  assert.equal(prompts.filter(prompt => prompt.includes('请调用 select_final_artifacts')).length, 2);
  assert.equal((await store.artifacts()).length, 2, 'both calculations stay in the task');
});

test('a selected result is not asked about again', async () => {
  const store = new MemoryStore(), run = row();
  let rounds = 0;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    rounds = index + 1;
    if (index === 0) return [{ type: 'toolCall', id: 'chart', name: 'bazi', arguments: bazi() }];
    if (index === 1) return [{ type: 'toolCall', id: 'select', name: 'select_final_artifacts', arguments: { artifactIds: [] } }];
    return [{ type: 'text', text: '本次不保存命盘。' }];
  }) });
  assert.equal(finished(store).args.p_status, 'completed');
  const checkpoint = finished(store).args.p_checkpoint as AgentRunRow['checkpoint'];
  assert.deepEqual(checkpoint.finalArtifacts, [], 'an empty selection is a decision, not a missing one');
  assert.equal(checkpoint.finalSelectionMade, true);
  assert.equal(rounds, 3);
});

test('an agent call with a Gregorian date reaches Core despite schema defaults', async () => {
  const store = new MemoryStore(), run = row();
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'divine', name: 'xiaoliuren', arguments: { date: '2026-02-14', hour: 9, question: '今日运势' } }];
    if (index === 1) return [{ type: 'toolCall', id: 'select', name: 'select_final_artifacts', arguments: { artifactIds: [] } }];
    return [{ type: 'text', text: '起课为大安。' }];
  }) });
  const finish = finished(store);
  assert.equal(finish.args.p_status, 'completed', (finish.args.p_message as AgentRunRow['public_message']).agent?.error);
  const part = ((finish.args.p_message as AgentRunRow['public_message']).agent?.parts ?? []).find(item => item.type === 'tool' && item.name === 'xiaoliuren');
  assert.equal(part?.type === 'tool' && part.status, 'completed');
});
