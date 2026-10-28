import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { runAgentEvalCase } from '../lib/agent/eval/runner.server';
import { buildAgentEvalLeaderboard } from '../lib/agent/eval/leaderboard';
import { BUILTIN_AGENT_EVAL_CASES } from '../lib/agent/eval/builtin-cases';
import type { AgentEvalCase } from '../lib/agent/eval/types';
import type { PiStreamFn } from '../lib/agent/types';
import { emptyPiAssistant } from '../lib/agent/pi-stream.server';
import { config, scripted } from './helpers/agent-runtime-fixture';

const baziArguments = { gender: 'male', birthYear: 1992, birthMonth: 8, birthDay: 14, birthHour: 7, birthMinute: 40 };
const baziCase: AgentEvalCase = {
  id: 'bazi',
  tool: 'bazi',
  guide: 'bazi',
  prompt: '我是男的，1992年8月14日早上7点40出生在杭州，帮我排一下八字。',
  assertions: ['调用真实计算工具，以 Core 结果为依据'],
  arguments: baziArguments,
};

function baziScript(call: Parameters<typeof scripted>[0]) {
  return () => scripted(call);
}

test('the offline runner executes a case through the real runtime and hard-checks Core', async (t) => {
  // Isolation: an evaluation must not read the member's credits or the platform switches.
  const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const creditRead = t.mock.method(credits, 'getUserCreditInfo', async () => { throw new Error('evaluation must not read credits'); });
  const featureRead = t.mock.method(settings, 'readFeatureModuleStateFresh', async () => { throw new Error('evaluation must not read feature switches'); });

  const outcome = await runAgentEvalCase({
    evalId: 'offline-run',
    case: baziCase,
    config,
    createStream: baziScript(index => index === 0
      ? [{ type: 'toolCall', id: 'guide', name: 'load_skill', arguments: { name: 'bazi' } }]
      : index === 1
        ? [{ type: 'toolCall', id: 'compute', name: 'bazi', arguments: baziArguments }]
        : [{ type: 'text', text: '壬水日主，月令申金。' }]),
  });

  assert.equal(outcome.completed, true);
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.hardPassed, true);
  assert.deepEqual(outcome.failedAssertions, []);
  assert.equal(outcome.guideLoaded, true);
  assert.deepEqual(outcome.toolTrace.map(call => [call.name, call.status]), [['load_skill', 'ok'], ['bazi', 'ok']]);
  assert.match(outcome.answer, /壬水日主/);
  assert.ok(outcome.core.length >= 1, 'Core text is kept for the quality judge');
  assert.ok(outcome.tokens.input > 0);
  assert.equal(creditRead.mock.callCount(), 0);
  assert.equal(featureRead.mock.callCount(), 0);
});

function scoringStream(text: string): PiStreamFn {
  return model => {
    const events = createAssistantMessageEventStream(), answer = emptyPiAssistant(model);
    answer.content = [{ type: 'text', text }];
    answer.stopReason = 'stop';
    events.push({ type: 'done', reason: 'stop', message: answer });
    events.end(answer);
    return events;
  };
}

test('the quality judge scores the answer against the case assertions', async () => {
  let judgeInput: unknown;
  const outcome = await runAgentEvalCase({
    evalId: 'judge-run',
    case: baziCase,
    config,
    createStream: baziScript(index => index === 0
      ? [{ type: 'toolCall', id: 'guide', name: 'load_skill', arguments: { name: 'bazi' } }]
      : index === 1
        ? [{ type: 'toolCall', id: 'compute', name: 'bazi', arguments: baziArguments }]
        : [{ type: 'text', text: '壬水日主，月令申金。' }]),
    judge: {
      config,
      stream: (model, context) => {
        judgeInput = JSON.parse(String(context.messages.at(-1)?.content));
        return scoringStream('{"passed":false,"failedAssertions":["引用依据不足"]}')(model, context);
      },
    },
  });
  assert.deepEqual(outcome.quality, { passed: false, failedAssertions: ['引用依据不足'] });
  assert.deepEqual(outcome.failedAssertions, ['引用依据不足']);
  assert.equal(outcome.stage, 'completed');
  assert.deepEqual(judgeInput, {
    question: baziCase.prompt,
    assertions: baziCase.assertions,
    answer: '壬水日主，月令申金。',
    core: outcome.core,
  });
});

test('a case that never calls its Core tool fails the hard check but keeps its tool trace', async () => {
  const outcome = await runAgentEvalCase({
    evalId: 'wrong-tool',
    case: baziCase,
    config,
    createStream: baziScript(index => index === 0
      ? [{ type: 'toolCall', id: 'guide', name: 'load_skill', arguments: { name: 'bazi' } }]
      : [{ type: 'text', text: '没有调用工具。' }]),
  });
  assert.equal(outcome.completed, true);
  assert.equal(outcome.hardPassed, false);
  assert.match(outcome.failedAssertions[0] ?? '', /未调用 bazi/u);
  assert.equal(outcome.stage, 'core-integrity');
  assert.deepEqual(outcome.toolTrace.map(call => call.name), ['load_skill']);
});

test('the leaderboard aggregates rates, mean and P95 duration, first token and tokens', () => {
  const leaderboard = buildAgentEvalLeaderboard([
    { modelId: 'model-a', hardPassed: true, qualityPassed: true, durationMs: 1000, firstTokenMs: 100, totalTokens: 100 },
    { modelId: 'model-a', hardPassed: true, qualityPassed: false, durationMs: 2000, firstTokenMs: 200, totalTokens: 200 },
    { modelId: 'model-a', hardPassed: false, qualityPassed: null, durationMs: 3000, firstTokenMs: null, totalTokens: 300 },
    { modelId: 'model-b', hardPassed: true, qualityPassed: true, durationMs: 500, firstTokenMs: 50, totalTokens: 90 },
  ]);
  assert.deepEqual(leaderboard.map(entry => entry.modelId), ['model-b', 'model-a']);
  const a = leaderboard.find(entry => entry.modelId === 'model-a')!;
  assert.equal(a.results, 3);
  assert.equal(a.hardPassed, 2);
  assert.equal(a.hardPassRate, 2 / 3);
  assert.equal(a.qualityJudged, 2, 'a failed hard check is not quality-scored');
  assert.equal(a.qualityPassed, 1);
  assert.equal(a.qualityPassRate, 0.5);
  assert.equal(a.meanDurationMs, 2000);
  assert.equal(a.p95DurationMs, 2900, 'percentile_cont interpolation');
  assert.equal(a.meanFirstTokenMs, 150);
  assert.equal(a.p95FirstTokenMs, 195);
  assert.equal(a.meanTokens, 200);
  const b = leaderboard.find(entry => entry.modelId === 'model-b')!;
  assert.equal(b.p95FirstTokenMs, 50);
});

test('built-in cases come from the CLI\'s JSON and keep their prompts and assertions', () => {
  // Every case in the CLI's JSON ships as a built-in case, once each: a new card or system adds to this list.
  const fromJson = JSON.parse(readFileSync('scripts/evals/agent-cases.json', 'utf8')) as Array<{ id: string }>;
  assert.equal(BUILTIN_AGENT_EVAL_CASES.length, fromJson.length);
  assert.equal(new Set(BUILTIN_AGENT_EVAL_CASES.map(item => item.id)).size, fromJson.length);
  assert.ok(BUILTIN_AGENT_EVAL_CASES.some(item => item.id === 'mangpai-career-2026'), 'school cards are covered');
  for (const item of BUILTIN_AGENT_EVAL_CASES) {
    assert.ok(item.prompt.length > 0 && item.assertions.length > 0 && item.tool.length > 0, item.id);
    assert.equal(item.builtin, true);
  }
  assert.ok(BUILTIN_AGENT_EVAL_CASES.some(item => item.chart?.tool === 'bazi'), 'drilldown cases carry their chart setup');
});
