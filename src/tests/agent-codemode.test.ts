import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentTools } from '@earendil-works/pi-ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { AgentRunRow } from '../lib/agent/store.server';
import type { AgentPart } from '../lib/agent/types';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { AGENT_CODEMODE_CALL_LIMIT } from '../lib/agent/codemode.server';
import { getAgentScript } from '../lib/agent/tool-presentation';
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

type ToolPart = Extract<AgentPart, { type: 'tool' }>;
const finished = (store: MemoryStore) => store.writes.find(write => write.name === 'agent_finish_run')!;
const toolParts = (store: MemoryStore) => ((finished(store).args.p_message as AgentRunRow['public_message']).agent?.parts ?? [])
  .filter((part): part is ToolPart => part.type === 'tool');

const BAZI_SCAN = `const lines = [];
for (const birthYear of [1990, 1991]) {
  const chart = await tools.bazi({ gender: 'male', birthYear, birthMonth: 1, birthDay: 15, birthHour: 9 });
  lines.push(birthYear + ':' + chart.data.四柱.map(pillar => pillar.干支).join('') + ':' + typeof chart.artifactId + ':' + (chart.text.length > 0));
}
return lines.join('\\n');`;

test('a code mode script calls Core tools as nested calls, each a public part under the script', async () => {
  const store = new MemoryStore(), run = row();
  run.input.codeMode = true;
  const prompts: string[] = [];
  let offered: string[] = [];
  const streamFn = scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'script', name: 'codemode', arguments: { code: BAZI_SCAN } }];
    return [{ type: 'text', text: '两年的命盘已比较完毕' }];
  }, messages => {
    prompts.push(JSON.stringify(messages.filter(message => message.role === 'system')));
    offered = getCurrentTools(messages).map(tool => tool.name);
  });
  await executeAgentRun(store, run, undefined, { config, streamFn });
  const finish = finished(store);
  assert.equal(finish.args.p_status, 'completed', (finish.args.p_message as AgentRunRow['public_message']).agent?.error);
  assert.ok(offered.includes('codemode'));
  assert.ok(prompts[0].includes('本任务开启了代码模式') && prompts[0].includes('bazi'), 'the section lists what scripts can call');
  assert.ok(!/脚本可调用：[^"]*\bask_user\b/u.test(prompts[0]), 'model-only tools are not offered to scripts');

  const parts = toolParts(store);
  const card = parts.find(part => part.name === 'codemode')!;
  assert.equal(card.status, 'completed');
  const script = getAgentScript(card)!;
  assert.equal(script.code, BAZI_SCAN);
  // The card shows what the script printed, without the header Pi writes for the model.
  assert.match(script.output ?? '', /^1990:\S{8}:string:true\n1991:\S{8}:string:true$/u);
  assert.deepEqual(script.calls.map(call => [call.id, call.name, call.status]), [[1, 'bazi', 'ok'], [2, 'bazi', 'ok']]);
  const calls = parts.filter(part => part.parentId === card.id);
  assert.deepEqual(calls.map(call => (call.input as { birthYear: number }).birthYear), [1990, 1991]);
  assert.deepEqual(calls.map(call => call.scriptCall), [1, 2], 'each part names the row of its call');
  for (const call of calls) {
    assert.equal(call.status, 'completed');
    assert.equal(typeof (call.output as { artifactId?: unknown }).artifactId, 'string', 'the part keeps the artifact envelope a direct call has');
    assert.ok(call.canonicalText?.includes('日主'), 'a script’s chart is chart basis like any other');
    assert.equal(typeof call.startedAt, 'number');
  }
  assert.deepEqual(parts.slice(parts.indexOf(card) + 1, parts.indexOf(card) + 3), calls, 'the calls follow their script');
  assert.equal(store.calculations().length, 2);
  // The model reads only the script's result; the nested calls never enter the transcript.
  const results = store.nativeEntries().flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult');
  assert.deepEqual(results.map(message => message.toolName), ['codemode']);
  // Details ride on the public parts only: the native log keeps the script's structured result, not the board.
  assert.ok(!JSON.stringify(store.log).includes('"board"'));
});

test('a call still running shows under its script and in the activity line', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  // Caching the chart is the last step of the call; holding it keeps the call running.
  class GatedStore extends MemoryStore {
    override async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      if (name === 'agent_cache_tool') await gate;
      return super.rpc<T>(name, args);
    }
  }
  const store = new GatedStore(), run = row();
  run.input.codeMode = true;
  const observed = (async () => {
    try {
      for (let attempt = 0; attempt < 300; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        const message = store.writes.filter(write => write.name === 'agent_checkpoint').at(-1)?.args.p_message as AgentRunRow['public_message'] | undefined;
        const call = message?.agent?.parts.find((part): part is ToolPart => part.type === 'tool' && part.parentId !== undefined);
        if (call) return { call, card: message!.agent!.parts.find(part => part.id === call.parentId), activity: message!.agent!.runtime?.activity };
      }
    } finally { release(); }
  })();
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'script', name: 'codemode', arguments: { code: `await tools.bazi({ gender: 'female', birthYear: 1992, birthMonth: 3, birthDay: 8, birthHour: 14 }); return 'ok';` } }];
    return [{ type: 'text', text: '已排盘' }];
  }) });
  assert.equal(finished(store).args.p_status, 'completed');
  const seen = await observed;
  assert.ok(seen, 'a projection showed the call while it ran');
  assert.equal(seen.call.status, 'running');
  assert.equal(seen.call.scriptCall, 1);
  // The call's arguments as the tool runs them, schema defaults included.
  assert.deepEqual([(seen.call.input as { birthYear?: unknown }).birthYear, (seen.call.input as { timezone?: unknown }).timezone], [1992, 'Asia/Shanghai']);
  assert.equal(seen.card?.type === 'tool' && seen.card.status, 'running', 'the call sits under its running script');
  assert.deepEqual(seen.activity, { phase: 'tools', toolTitle: `运行脚本 · ${seen.call.title}` });
  // Once settled, the placeholder gives way to the call's own part: one part per call, never two.
  const calls = toolParts(store).filter(part => part.parentId === seen.call.parentId);
  assert.deepEqual(calls.map(call => [call.id, call.status]), [[seen.call.id, 'completed']]);
});

test('a script may call a deferred tool the model was not offered', async () => {
  const store = new MemoryStore(), run = row();
  run.input.codeMode = true;
  let offered: string[] = [], prompt = '';
  const code = `const dayun = await tools.bazi_dayun({ gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 });
return typeof dayun.text + ':' + dayun.data.大运列表.length;`;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'script', name: 'codemode', arguments: { code } }];
    return [{ type: 'text', text: '大运已排好' }];
  }, messages => {
    if (!offered.length) {
      offered = getCurrentTools(messages).map(tool => tool.name);
      prompt = JSON.stringify(messages.filter(message => message.role === 'system'));
    }
  }) });
  assert.equal(finished(store).args.p_status, 'completed');
  assert.ok(offered.includes('codemode') && offered.includes('bazi'));
  assert.ok(!offered.includes('bazi_dayun'), 'the calculation is deferred for the model');
  assert.ok(prompt.includes('bazi_dayun'), 'the script section names it among the callable tools');
  const card = toolParts(store).find(part => part.name === 'codemode')!;
  assert.match(getAgentScript(card)?.output ?? '', /^string:\d+$/u);
  const call = toolParts(store).find(part => part.parentId === card.id)!;
  assert.equal(call.name, 'bazi_dayun');
  assert.equal(call.status, 'completed');
  assert.ok(call.canonicalText?.includes('大运'), 'a deferred calculation keeps its canonical text like a direct call');
});

test('scripts cannot call model-only tools and stop at the call limit', async () => {
  const store = new MemoryStore(), run = row();
  run.input.codeMode = true;
  const code = `const errors = [];
try { await tools.ask_user({ question: '出生时间？' }); } catch (error) { errors.push('ask:' + error.message); }
for (let index = 1; index <= ${AGENT_CODEMODE_CALL_LIMIT + 1}; index++) {
  try { await tools.xiaoliuren({ lunarMonth: 9, lunarDay: 1, hour: 9 }); } catch (error) { errors.push(index + ':' + error.message); }
}
return errors.join('\\n');`;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'script', name: 'codemode', arguments: { code } }];
    return [{ type: 'text', text: '脚本已结束' }];
  }) });
  assert.equal(finished(store).args.p_status, 'completed');
  const card = toolParts(store).find(part => part.name === 'codemode')!;
  const output = getAgentScript(card)?.output ?? '';
  assert.match(output, /^ask:tools\.ask_user does not exist/mu);
  assert.match(output, new RegExp(`^${AGENT_CODEMODE_CALL_LIMIT + 1}:Tool call blocked: 单个脚本最多发起 ${AGENT_CODEMODE_CALL_LIMIT} 次调用`, 'mu'));
  assert.equal(output.split('\n').length, 2, `every call within the limit ran:\n${output.slice(0, 800)}`);
  assert.equal(store.calculations().length, AGENT_CODEMODE_CALL_LIMIT);
  // A blocked call never ran: it has no part of its own, only the script's row. Asking for a tool that does not
  // exist fails inside the script and is no call at all.
  const calls = toolParts(store).filter(part => part.parentId === card.id);
  assert.deepEqual(calls.map(part => part.scriptCall), Array.from({ length: AGENT_CODEMODE_CALL_LIMIT }, (_, index) => index + 1));
  const rows = getAgentScript(card)?.calls ?? [];
  assert.deepEqual([rows.length, rows.at(-1)?.id, rows.at(-1)?.status], [AGENT_CODEMODE_CALL_LIMIT + 1, AGENT_CODEMODE_CALL_LIMIT + 1, 'error']);
});

test('code mode stays off unless the task was created with it', async () => {
  const store = new MemoryStore(), run = row();
  let offered: string[] = [];
  let prompt = '';
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => [{ type: 'text', text: '直接回答' }], messages => {
    offered = getCurrentTools(messages).map(tool => tool.name);
    prompt = JSON.stringify(messages.filter(message => message.role === 'system'));
  }) });
  assert.equal(finished(store).args.p_status, 'completed');
  assert.ok(offered.length && !offered.includes('codemode'));
  assert.ok(!prompt.includes('代码模式'));
});
