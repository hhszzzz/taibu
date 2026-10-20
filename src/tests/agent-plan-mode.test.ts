import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentTools, type ToolResultMessage } from '@earendil-works/pi-ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { AgentRunRow } from '../lib/agent/store.server';
import type { AgentPart } from '../lib/agent/types';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { summarizeAgentTool } from '../components/chat/agent/presentation';
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
const finished = (store: MemoryStore) => store.writes.filter(write => write.name === 'agent_finish_run').at(-1)!;
const parts = (store: MemoryStore) => ((finished(store).args.p_message as AgentRunRow['public_message']).agent?.parts ?? []);
const toolParts = (store: MemoryStore) => parts(store).filter((part): part is ToolPart => part.type === 'tool');
const results = (store: MemoryStore) => store.nativeEntries().flatMap(entry => entry.model ?? [])
  .filter((message): message is ToolResultMessage => message.role === 'toolResult');
const text = (message: ToolResultMessage) => message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
/** Writing memory is execution the plan asks about; the user's words are its own evidence. */
const remember = { type: 'toolCall' as const, id: 'remember', name: 'remember_user_fact', arguments: { title: '回答偏好', content: '我喜欢先看结论再看依据', kind: 'preference', evidence: '我喜欢先看结论再看依据' } };

/** The command the API would have written for a reply in the dock. */
const reply = (sequence: number, answers: Record<string, string[]>) => ({
  sequence,
  mode: 'reply' as const,
  message: {
    id: `reply-${sequence}`, role: 'user' as const, content: '是否按这个计划执行？\n' + Object.values(answers).flat().join('、'),
    createdAt: new Date().toISOString(), metadata: { agentAnswers: answers },
  },
});

test('plan mode blocks execution, submits the plan and continues once the user approves', async () => {
  const store = new MemoryStore(), run = row();
  run.input.planMode = true;
  run.input.memoryEnabled = true;
  let offered: string[] = [];
  const first = scripted(index => {
    if (index === 0) return [remember];
    return [{ type: 'toolCall', id: 'plan', name: 'submit_plan', arguments: { plan: '# 分析计划\n1. 先排八字，再看紫微。' } }];
  }, messages => { if (!offered.length) offered = getCurrentTools(messages).map(tool => tool.name); });
  await executeAgentRun(store, run, undefined, { config, streamFn: first });

  assert.ok(offered.includes('submit_plan'), 'plan mode offers the plan tool');
  assert.equal(finished(store).args.p_status, 'awaiting_input');
  const blocked = results(store).find(message => message.toolName === 'remember_user_fact')!;
  assert.match(text(blocked), /计划尚未批准/u, 'a gated tool cannot run before approval');
  const checkpoint = finished(store).args.p_checkpoint as AgentRunRow['checkpoint'];
  assert.equal(checkpoint.question, '是否按这个计划执行？');
  assert.equal(checkpoint.planApproved, undefined);
  const question = checkpoint.parts.find((part): part is Extract<AgentPart, { type: 'question' }> => part.type === 'question')!;
  assert.equal(question.questions?.[0].id, 'plan');
  assert.deepEqual(question.questions?.[0].options?.map(option => option.label), ['批准', '要求修改']);
  assert.equal(toolParts(store).find(part => part.name === 'submit_plan')?.status, 'running', 'the plan waits for the answer');

  run.checkpoint = checkpoint;
  store.pending = [reply(7, { plan: ['approve'] })];
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index === 0) return [remember];
    return [{ type: 'text', text: '按计划完成分析' }];
  }) });
  assert.equal(finished(store).args.p_status, 'completed');
  const approved = results(store).find(message => message.toolName === 'submit_plan')!;
  assert.match(text(approved), /用户已批准计划/u);
  const plan = toolParts(store).find(part => part.name === 'submit_plan')!;
  assert.equal(plan.status, 'completed');
  assert.equal(summarizeAgentTool(plan), '已批准');
  assert.equal((finished(store).args.p_checkpoint as AgentRunRow['checkpoint']).planApproved, true);
  // The first attempt is still in the transcript as a blocked call. After approval the plan gate is lifted; the
  // tool's own policy still applies (this fixture has no settings to read, so the memory check refuses it).
  const attempts = results(store).filter(message => message.toolName === 'remember_user_fact');
  assert.equal(attempts.length, 2);
  assert.doesNotMatch(text(attempts.at(-1)!), /计划尚未批准/u);
});

test('a revision keeps the task gated until a later plan is approved', async () => {
  const store = new MemoryStore(), run = row();
  run.input.planMode = true;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => [
    { type: 'toolCall', id: 'plan-1', name: 'submit_plan', arguments: { plan: '先看八字。' } },
  ]) });
  assert.equal(finished(store).args.p_status, 'awaiting_input');
  run.checkpoint = finished(store).args.p_checkpoint as AgentRunRow['checkpoint'];
  store.pending = [reply(8, { plan: ['先看紫微，再看八字'] })];

  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => index === 0
    ? [{ type: 'toolCall', id: 'plan-2', name: 'submit_plan', arguments: { plan: '先看紫微，再看八字。' } }]
    : [{ type: 'text', text: '不应走到这里' }]) });
  assert.equal(finished(store).args.p_status, 'awaiting_input', 'the revised plan waits for its own approval');
  const revised = toolParts(store).filter(part => part.name === 'submit_plan');
  assert.deepEqual(revised.map(part => part.status).sort(), ['completed', 'running'], 'the answered plan settled; the revised one is a live call');
  const answered = revised.find(part => part.status === 'completed')!;
  assert.equal(summarizeAgentTool(answered), '要求修改');
  assert.equal((answered.output as { feedback?: string }).feedback, '先看紫微，再看八字');
  assert.equal((finished(store).args.p_checkpoint as AgentRunRow['checkpoint']).planApproved, false);

  run.checkpoint = finished(store).args.p_checkpoint as AgentRunRow['checkpoint'];
  store.pending = [reply(9, { plan: ['approve'] })];
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => [{ type: 'text', text: '按修订后的计划完成' }]) });
  assert.equal(finished(store).args.p_status, 'completed');
  assert.equal((finished(store).args.p_checkpoint as AgentRunRow['checkpoint']).planApproved, true);
});

test('plan mode keeps background subagents for after the approval', async () => {
  const store = new MemoryStore(), run = row();
  run.input.planMode = true;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => index === 0
    ? [{ type: 'toolCall', id: 'spawn', name: 'background_agent', arguments: { action: 'spawn', name: '八字复核', system: 'bazi', message: '看事业' } }]
    : [{ type: 'toolCall', id: 'plan', name: 'submit_plan', arguments: { plan: '先排八字，再请八字复核看事业。' } }]) });
  assert.equal(finished(store).args.p_status, 'awaiting_input');
  assert.match(text(results(store).find(message => message.toolName === 'background_agent')!), /计划尚未批准/u);
  assert.equal((finished(store).args.p_checkpoint as AgentRunRow['checkpoint']).background, undefined, 'nothing was started');
});

test('an answer before the plan is nudged back, at most twice', async () => {
  const store = new MemoryStore(), run = row();
  run.input.planMode = true;
  const seen: string[][] = [];
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index < 2) return [{ type: 'text', text: '直接回答' }];
    return [{ type: 'toolCall', id: 'plan', name: 'submit_plan', arguments: { plan: '先排盘，再解读。' } }];
  }, messages => seen.push(messages.flatMap(message => message.role === 'user' && typeof message.content === 'string' ? [message.content] : []))) });
  assert.equal(finished(store).args.p_status, 'awaiting_input');
  assert.equal((finished(store).args.p_checkpoint as AgentRunRow['checkpoint']).planNudges, 2);
  assert.ok(seen[1].some(content => content.includes('请先调用 submit_plan')), 'the nudge reaches the model as a user turn');
  assert.ok(seen[2].some(content => content.includes('请先调用 submit_plan')));
});
