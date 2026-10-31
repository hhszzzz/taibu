import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import { createAssistantMessageEventStream, getCurrentTools, type Message } from '@earendil-works/pi-ai';
import type { PiStreamFn as StreamFn } from '../lib/agent/types';
import type { AgentRunRow } from '../lib/agent/store.server';
import { AGENT_MANUAL_COMPACTION_FAILED_MESSAGE, executeAgentRun } from '../lib/agent/runtime.server';
import { emptyPiAssistant } from '../lib/agent/pi-stream.server';
import { parseAgentCompactCommand } from '../lib/agent/compaction';
import { config, isSummaryTranscript, MemoryStore, row } from './helpers/agent-runtime-fixture';

beforeEach((t) => {
  assert.ok('mock' in t);
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const sdk = require('../lib/ai/providers/ai-sdk-provider') as typeof import('../lib/ai/providers/ai-sdk-provider');
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
  t.mock.method(sdk, 'isModelAvailable', () => true);
  t.mock.method(sdk, 'createModelFromConfig', () => new MockLanguageModelV3());
});

const SUMMARY = '用户在问八字：日主庚金，已排盘并看过 2027 年。';

/** A `/compact` task over `turns` earlier messages of about 4k tokens each. */
function compactRun(turns: number, instructions: string | null = '保留八字结论'): AgentRunRow {
  const run = row();
  run.billing = 'exempt';
  run.input.compact = { instructions };
  run.checkpoint.messages = [
    ...Array.from({ length: turns }, (_, index): Message => ({ role: 'user', content: `问 ${index}: ${'history '.repeat(2000)}`, timestamp: index + 1 })),
    { role: 'user', content: `/compact ${instructions ?? ''}`.trim(), timestamp: turns + 1 },
  ];
  return run;
}

function summaryStream(text: string | null): StreamFn {
  return model => {
    const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
    if (text === null) {
      message.stopReason = 'error';
      message.errorMessage = 'summary provider unavailable';
      output.push({ type: 'error', reason: 'error', error: message });
    } else {
      message.content = [{ type: 'text', text }];
      output.push({ type: 'done', reason: 'stop', message });
    }
    output.end(message);
    return output;
  };
}

const finished = (store: MemoryStore) => store.writes.filter(write => write.name === 'agent_finish_run').at(-1)!;
const publicMessage = (store: MemoryStore) => finished(store).args.p_message as AgentRunRow['public_message'];

test('/compact parses only the command and its optional focus', () => {
  assert.deepEqual(parseAgentCompactCommand('/compact'), { instructions: null });
  assert.deepEqual(parseAgentCompactCommand('  /compact  保留八字结论\n和流年 '), { instructions: '保留八字结论\n和流年' });
  for (const other of ['/compactness', 'compact', '请 /compact', '/new']) assert.equal(parseAgentCompactCommand(other), null, other);
});

test('a /compact task summarizes the old context with the focus, keeps the recent part and never asks the main model', async () => {
  const store = new MemoryStore(), run = compactRun(6);
  const seeded = run.checkpoint.messages.length - 1;
  let answers = 0, summaries = 0, focus = false;
  const summarize = summaryStream(SUMMARY);
  await executeAgentRun(store, run, undefined, { config, streamFn: (model, context, options) => {
    if (!isSummaryTranscript(context)) { answers++; assert.equal(getCurrentTools(context.messages).length > 0, true); }
    summaries++;
    focus ||= JSON.stringify(context.messages).includes('用户对这次压缩的要求（只决定侧重与取舍，不改变上述规则）：保留八字结论');
    return summarize(model, context, options);
  } });
  assert.equal(answers, 0, 'the command is not a question');
  assert.equal(summaries, 1);
  assert.ok(focus, 'the focus reaches the summary request');
  const finish = finished(store);
  assert.equal(finish.args.p_status, 'completed');
  const message = publicMessage(store);
  assert.match(message.content, /^已压缩上下文/);
  assert.equal(message.agent?.compactions?.[0].status, 'completed');
  assert.equal(message.agent?.compactions?.[0].summary, SUMMARY);
  const messages = (finish.args.p_checkpoint as AgentRunRow['checkpoint']).messages;
  assert.ok(messages.length < seeded, 'older turns become one summary');
  assert.ok(JSON.stringify(messages[0]).includes(SUMMARY), 'the next task starts from the summary');
  assert.ok(!JSON.stringify(messages).includes('/compact'), 'the command itself never enters the context');
  assert.equal(message.agent?.runtime?.context?.compactions, 1);
});

test('a /compact task with too little context completes unchanged without any model call', async () => {
  const store = new MemoryStore(), run = compactRun(1, null);
  await executeAgentRun(store, run, undefined, { config, streamFn: () => { throw new Error('nothing to summarize'); } });
  const finish = finished(store);
  assert.equal(finish.args.p_status, 'completed');
  assert.match(publicMessage(store).content, /没有需要压缩的内容/);
  assert.equal(publicMessage(store).agent?.compactions, undefined);
  assert.equal((finish.args.p_checkpoint as AgentRunRow['checkpoint']).messages.length, 1, 'the context stays as it was');
});

test('a failed /compact keeps the original context and reports the failure', async () => {
  const store = new MemoryStore(), run = compactRun(6);
  const seeded = run.checkpoint.messages.length - 1;
  let summaries = 0;
  const fail = summaryStream(null);
  await executeAgentRun(store, run, undefined, { config, streamFn: (model, context, options) => { summaries++; return fail(model, context, options); } });
  assert.equal(summaries, 2, "taibu's summary and Pi's built-in retry");
  const finish = finished(store);
  assert.equal(finish.args.p_status, 'failed');
  assert.equal(publicMessage(store).agent?.error, AGENT_MANUAL_COMPACTION_FAILED_MESSAGE);
  assert.equal((finish.args.p_checkpoint as AgentRunRow['checkpoint']).messages.length, seeded);
});

test('a /compact task stopped before it starts compacts nothing', async () => {
  const store = new MemoryStore(), run = compactRun(6);
  run.cancel_requested = true;
  await executeAgentRun(store, run, undefined, { config, streamFn: () => { throw new Error('a stopped task calls no model'); } });
  assert.equal(finished(store).args.p_status, 'cancelled');
  assert.equal(publicMessage(store).agent?.compactions, undefined);
});
