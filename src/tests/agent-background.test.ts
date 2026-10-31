import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import {
  createAssistantMessageEventStream, getCurrentTools,
  type Api, type AssistantMessage, type AssistantMessageEventStream, type JsonObject, type Message, type Model, type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { AgentMessageData, AgentPart, PiStreamFn } from '../lib/agent/types';
import type { AgentRunRow } from '../lib/agent/store.server';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { emptyPiAssistant } from '../lib/agent/pi-stream.server';
import { condenseBackgroundTranscript } from '../lib/agent/background.server';
import { parallelAnalysisResults } from '../lib/agent/parallel-results';
import { buildAgentWorkspace, getAgentWorkspaceAutoOpenEvent } from '../lib/agent/workspace';
import { getAgentLiveLine, summarizeAgentActivity, summarizeAgentTool, type AgentTool } from '../components/chat/agent/presentation';
import { config, MemoryStore, row } from './helpers/agent-runtime-fixture';

beforeEach((t) => {
  assert.ok('mock' in t);
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const sdk = require('../lib/ai/providers/ai-sdk-provider') as typeof import('../lib/ai/providers/ai-sdk-provider');
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
  t.mock.method(sdk, 'isModelAvailable', () => true);
  t.mock.method(sdk, 'createModelFromConfig', () => new MockLanguageModelV3());
});

const BAZI = { birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, gender: 'male' };
const REPORT = /^\[后台子分析「.+?」回报\]/u;
const MODEL = { id: config.id, provider: 'taibu' } as Model<Api>;

const textOf = (message: Message | undefined) => !message ? ''
  : typeof message.content === 'string' ? message.content
  : message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
const lastInput = (messages: readonly Message[]) => messages.findLast(message => message.role !== 'system');
const results = (messages: readonly Message[], name: string) => messages.filter(message => message.role === 'toolResult' && message.toolName === name);
const isMain = (messages: readonly Message[]) => getCurrentTools(messages).some(tool => tool.name === 'background_agent');
const reportTurn = (messages: readonly Message[]) => { const input = lastInput(messages); return input?.role === 'user' && REPORT.test(textOf(input)); };
const manage = (id: string, args: JsonObject) => ({ type: 'toolCall' as const, id, name: 'background_agent', arguments: args });
const say = (text: string): AssistantMessage['content'] => [{ type: 'text', text }];
const answer = (text: string, timestamp = 2): AssistantMessage => ({ ...emptyPiAssistant(MODEL), content: [{ type: 'text', text }], timestamp });

/** A finished response, after `wait` when given: a slow subagent, or a main agent that waits for a subagent to start. */
function respond(model: Model<Api>, content: AssistantMessage['content'], wait?: Promise<unknown>): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
  message.content = content;
  message.stopReason = content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop';
  message.usage.input = 10;
  message.usage.totalTokens = 10;
  const done = () => { output.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message }); output.end(message); };
  if (wait) void wait.then(done); else done();
  return output;
}

/** A response that only ends when its generation is aborted. */
function hanging(model: Model<Api>, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
  output.push({ type: 'start', partial: message });
  options!.signal!.addEventListener('abort', () => {
    message.stopReason = 'aborted';
    output.push({ type: 'error', reason: 'aborted', error: message });
    output.end(message);
  }, { once: true });
  return output;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const finished = (store: MemoryStore) => store.writes.findLast(write => write.name === 'agent_finish_run')!;
const finalCheckpoint = (store: MemoryStore) => finished(store).args.p_checkpoint as AgentRunRow['checkpoint'];
const backgroundCards = (parts: AgentPart[]) => parts.filter((part): part is Extract<AgentPart, { type: 'tool' }> => part.type === 'tool' && part.name === 'background_agent');
const reports = (messages: readonly Message[]) => messages.filter(message => message.role === 'user' && REPORT.test(textOf(message)));

test('a kept subagent remembers each request with its final answer, not its process', () => {
  const messages: Message[] = [
    { role: 'user', content: '<summary>早先：日主庚金</summary>', timestamp: 1 },
    { role: 'user', content: '看事业', timestamp: 2 },
    { ...answer('先排盘'), stopReason: 'toolUse', content: [{ type: 'thinking', thinking: '先排盘再说' }, { type: 'text', text: '先排盘' }, { type: 'toolCall', id: 'c', name: 'bazi', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'c', toolName: 'bazi', content: [{ type: 'text', text: '四柱' }], isError: false, timestamp: 3 },
    { ...answer('事业：2027 有变动'), content: [{ type: 'thinking', thinking: '看官杀' }, { type: 'text', text: '事业：2027 有变动' }] },
    { role: 'user', content: '再看 2028', timestamp: 4 },
    answer('长'.repeat(9000)),
    { role: 'user', content: '这条被中止了', timestamp: 5 },
    { ...answer('半截'), stopReason: 'aborted' },
  ];
  const condensed = condenseBackgroundTranscript(messages);
  assert.deepEqual(condensed.map(message => [message.role, textOf(message).slice(0, 40)]), [
    ['user', '<summary>早先：日主庚金</summary>'], ['user', '看事业'], ['assistant', '事业：2027 有变动'],
    ['user', '再看 2028'], ['assistant', '长'.repeat(40)],
  ], 'a summary stays with its request; an unanswered request is dropped');
  assert.ok(condensed.every(message => message.role !== 'assistant' || message.content.every(part => part.type === 'text')), 'no reasoning or tool calls');
  assert.ok(textOf(condensed.at(-1)).length < 8100, 'a long answer is cut');
  const many = Array.from({ length: 8 }, (_, index): Message[] => [{ role: 'user', content: `问 ${index}`, timestamp: index }, answer(`答 ${index}`)]).flat();
  assert.deepEqual(condenseBackgroundTranscript(many).filter(message => message.role === 'user').map(textOf), ['问 2', '问 3', '问 4', '问 5', '问 6', '问 7'], 'the latest six exchanges');
});

test('a subagent works while the main agent answers, and the task waits for its report to start a new turn', { timeout: 30000 }, async () => {
  const store = new MemoryStore(), run = row();
  const offers: string[][] = [];
  const streamFn: PiStreamFn = (model, context) => {
    if (isMain(context.messages)) {
      if (reportTurn(context.messages)) return respond(model, say('综合八字复核的回报：2027 年事业有变动。'));
      if (!results(context.messages, 'background_agent').length)
        return respond(model, [manage('spawn', { action: 'spawn', name: '八字复核', system: 'bazi', message: `请排盘并看事业：${JSON.stringify(BAZI)}` })]);
      return respond(model, say('初步判断已给出，八字复核的结论稍后整合。'));
    }
    offers.push(getCurrentTools(context.messages).map(tool => tool.name));
    if (!results(context.messages, 'load_skill').length) return respond(model, [{ type: 'toolCall', id: 'guide', name: 'load_skill', arguments: { name: 'bazi' } }]);
    if (!results(context.messages, 'bazi').length) return respond(model, [{ type: 'toolCall', id: 'chart', name: 'bazi', arguments: BAZI }]);
    // Slower than the main agent, so the task waits with nothing but the report to wait for.
    return respond(model, say('八字复核结论：日主庚金，2027 年事业有变动。'), sleep(2500));
  };
  await executeAgentRun(store, run, undefined, { config, streamFn });
  assert.equal(finished(store).args.p_status, 'completed');
  assert.match((finished(store).args.p_message as AgentRunRow['public_message']).content, /综合八字复核的回报/);
  const checkpoint = finalCheckpoint(store);
  const [card] = backgroundCards(checkpoint.parts);
  assert.equal(card.status, 'completed');
  const [member] = parallelAnalysisResults(card.output);
  assert.deepEqual([member.name, member.system, member.status], ['八字复核', 'bazi', 'completed']);
  assert.match(member.answer ?? '', /八字复核结论/);
  assert.deepEqual(member.steps?.map(step => step.name), ['load_skill', 'bazi']);
  assert.equal(member.toolCalls, 2);
  // While only the subagent worked, its card ran and the task said what it waited for.
  assert.ok(store.writes.some(write => {
    if (write.name !== 'agent_checkpoint') return false;
    const agent = (write.args.p_message as AgentRunRow['public_message']).agent;
    return agent?.runtime?.activity?.phase === 'background' && backgroundCards(agent.parts).some(part => part.status === 'running');
  }), 'the running card and the waiting task are projected');
  assert.equal(reports(checkpoint.messages).length, 1, 'the report reached the main conversation once');
  assert.deepEqual(checkpoint.background?.map(item => [item.name, item.system, item.messages.map(message => message.role)]), [['八字复核', 'bazi', ['user', 'assistant']]]);
  // A subagent sees its system's tools, deferred drilldowns included, and cannot nest, ask, plan or search.

  assert.ok(offers.length && offers.every(names => names.includes("bazi") && names.includes("bazi_relations") && names.includes("load_skill")));
  for (const name of ['background_agent', 'parallel_analysis', 'ask_user', 'tool_search', 'todo_write', 'ziwei', 'web_search'])
    assert.ok(offers.every(names => !names.includes(name)), name);
  assert.equal(store.writes.filter(write => /create_run|deduct|charge|credit/.test(write.name)).length, 0, 'one charge covers the task');
});

test('the next task recreates a kept subagent, which continues from what it remembers', { timeout: 30000 }, async () => {
  const store = new MemoryStore(), run = row();
  run.checkpoint.background = [{ name: '八字复核', system: 'bazi', messages: [
    { role: 'user', content: '请看 1990-01-15 9 时男命的事业', timestamp: 1 },
    answer('八字复核结论：日主庚金，2027 年事业有变动。'),
  ] }];
  let listed = false, remembered = false;
  const streamFn: PiStreamFn = (model, context) => {
    const transcript = JSON.stringify(context.messages);
    if (isMain(context.messages)) {
      listed ||= transcript.includes('本对话的常驻后台子分析（可用 send 继续交给它们）：八字复核（子平八字）');
      if (reportTurn(context.messages)) return respond(model, say('整合八字复核：2028 年财星透出。'));
      if (!results(context.messages, 'background_agent').length) return respond(model, [manage('send', { action: 'send', name: '八字复核', message: '接着看 2028 年' })]);
      return respond(model, say('已请八字复核接着看 2028 年。'));
    }
    remembered ||= transcript.includes('请看 1990-01-15 9 时男命的事业') && transcript.includes('八字复核结论：日主庚金');
    return respond(model, say('2028 年：财星透出，宜守。'));
  };
  await executeAgentRun(store, run, undefined, { config, streamFn });
  assert.equal(finished(store).args.p_status, 'completed');
  assert.ok(listed, 'the main agent knows the subagents the conversation kept');
  assert.ok(remembered, 'the subagent continues from its earlier exchange');
  const checkpoint = finalCheckpoint(store);
  const [earlier, sent] = checkpoint.background?.[0].messages.filter(message => message.role === 'user').map(textOf) ?? [];
  assert.equal(earlier, '请看 1990-01-15 9 时男命的事业');
  // A message to a subagent is dated in the user's time zone, as the user's own messages are.
  assert.match(sent, /^【发送时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2} 星期.，Asia\/Shanghai（UTC\+08:00）】\n接着看 2028 年$/u);
  assert.equal(reports(checkpoint.messages).length, 1);
});

test('a stopped message reports nothing, and a dismissed subagent is not kept', { timeout: 30000 }, async () => {
  const store = new MemoryStore(), run = row();
  let started!: () => void;
  const working = new Promise<void>(resolve => { started = resolve; });
  const streamFn: PiStreamFn = (model, context, options) => {
    if (isMain(context.messages)) {
      const done = results(context.messages, 'background_agent').length;
      if (done === 0) return respond(model, [manage('spawn', { action: 'spawn', name: '长线推演', system: 'bazi', message: '逐年推演五十年' })]);
      // Stops it only once it is working on the message.
      if (done === 1) return respond(model, [manage('stop', { action: 'stop', name: '长线推演' })], working);
      if (done === 2) return respond(model, [manage('dismiss', { action: 'dismiss', name: '长线推演' })]);
      return respond(model, say('已停止并解散长线推演。'));
    }
    started();
    return hanging(model, options);
  };
  await executeAgentRun(store, run, undefined, { config, streamFn });
  assert.equal(finished(store).args.p_status, 'completed');
  const checkpoint = finalCheckpoint(store);
  assert.equal(reports(checkpoint.messages).length, 0, 'a stopped message reports nothing');
  const [spawn, stop, dismiss] = backgroundCards(checkpoint.parts);
  assert.equal(parallelAnalysisResults(spawn.output)[0].status, 'failed');
  assert.deepEqual([spawn.status, stop.status, dismiss.status], ['completed', 'completed', 'completed']);
  assert.equal(checkpoint.background, undefined, 'a dismissed subagent is not carried over');
});

test('a conversation keeps three subagents, a message needs a known name, and a task sends at most eight', { timeout: 30000 }, async () => {
  const store = new MemoryStore(), run = row();
  const calls = [
    manage('no-system', { action: 'spawn', name: '甲', message: '看事业' }),
    ...['甲', '乙', '丙', '丁'].map(name => manage(`spawn-${name}`, { action: 'spawn', name, system: 'bazi', message: `${name}看事业` })),
    manage('unknown', { action: 'send', name: '戊', message: '看财运' }),
    ...Array.from({ length: 6 }, (_, index) => manage(`send-${index}`, { action: 'send', name: '甲', message: `补充 ${index}`, followUp: true })),
  ];
  const streamFn: PiStreamFn = (model, context) => {
    if (isMain(context.messages)) {
      if (!results(context.messages, 'background_agent').length) return respond(model, calls);
      return respond(model, say('已安排。'));
    }
    return respond(model, say(`结论：${textOf(lastInput(context.messages))}`));
  };
  await executeAgentRun(store, run, undefined, { config, streamFn });
  assert.equal(finished(store).args.p_status, 'completed');
  const checkpoint = finalCheckpoint(store);
  const cards = backgroundCards(checkpoint.parts);
  assert.equal(cards.length, calls.length);
  assert.deepEqual(cards.filter(item => item.status === 'failed').map(item => (item.input as { message: string }).message), ['看事业', '丁看事业', '看财运', '补充 5'],
    'no system, a fourth subagent, an unknown name, and a ninth message fail');
  assert.deepEqual(checkpoint.background?.map(item => item.name), ['甲', '乙', '丙']);
  assert.ok(reports(checkpoint.messages).length >= 3, 'every subagent reported');
  assert.equal(new Set(reports(checkpoint.messages).map(textOf)).size, reports(checkpoint.messages).length, 'no report twice');
});

test('a task interrupted while a subagent works resumes it, and its message and report each arrive once', { timeout: 30000 }, async () => {
  const store = new MemoryStore(), run = row(), abort = new AbortController();
  let interrupt = true;
  const deliveries: number[] = [];
  const streamFn: PiStreamFn = (model, context) => {
    if (isMain(context.messages)) {
      if (reportTurn(context.messages)) return respond(model, say('整合八字复核的回报。'));
      if (!results(context.messages, 'background_agent').length) return respond(model, [manage('spawn', { action: 'spawn', name: '八字复核', system: 'bazi', message: '请看事业运' })]);
      return respond(model, say('等待八字复核。'));
    }
    deliveries.push(context.messages.filter(message => message.role === 'user' && textOf(message).endsWith('】\n请看事业运')).length);
    if (interrupt) {
      interrupt = false;
      setTimeout(() => abort.abort(), 20);
      return createAssistantMessageEventStream();
    }
    return respond(model, say('八字复核结论：事业运平稳。'));
  };
  await executeAgentRun(store, run, abort.signal, { config, streamFn });
  assert.equal(store.writes.filter(write => write.name === 'agent_finish_run').length, 0, 'an interrupted task does not settle');
  run.checkpoint = structuredClone(store.writes.findLast(write => write.name === 'agent_durable_commit')!.args.p_checkpoint) as AgentRunRow['checkpoint'];
  await executeAgentRun(store, run, undefined, { config, streamFn });
  assert.equal(finished(store).args.p_status, 'completed');
  assert.ok(deliveries.length >= 2 && deliveries.every(count => count === 1), 'the subagent got the message once');
  assert.equal(reports(finalCheckpoint(store).messages).length, 1, 'the report arrived once');
});

const card = (id: string, input: Record<string, unknown>, output?: unknown, status: AgentTool['status'] = 'completed'): AgentTool =>
  ({ type: 'tool', id, name: 'background_agent', title: '后台子分析', status, input, ...(output === undefined ? {} : { output }) });

test('background cards read as their subagent: live line, step summary, activity count and workspace page', () => {
  const running = card('spawn', { action: 'spawn', name: '八字复核', system: 'bazi', message: '请看事业' },
    { action: 'spawn', name: '八字复核', system: 'bazi', conversationId: 2, reporterId: 5, analyses: [{ system: 'bazi', conversationId: 2, status: 'running', name: '八字复核' }] }, 'running');
  const data: AgentMessageData = { version: 1, runId: 'r', status: 'running', parts: [running],
    runtime: { model: { id: 'm', name: 'm', contextWindow: null, limitSource: 'unknown' }, activity: { phase: 'background' } } };
  assert.equal(getAgentLiveLine(data), '等待后台子分析回报 · 八字复核 正在分析');
  assert.equal(summarizeAgentTool(running), '八字复核 · 新建并交给任务');
  const send = card('send', { action: 'send', name: '八字复核', message: '接着看 2028' });
  const status = card('status', { action: 'status' }, { action: 'status' });
  assert.equal(summarizeAgentTool(send), '八字复核 · 追加任务');
  assert.equal(summarizeAgentTool(status), '查看子分析状态');
  assert.equal(summarizeAgentActivity([running, send, status], 0, 0), '开启 1 个智能体', 'a subagent counts once, when it starts');
  const workspace = buildAgentWorkspace({ parts: [running, status], artifacts: [], attachmentIds: [] });
  assert.deepEqual(workspace.resources.map(resource => [resource.id, resource.view, resource.title]), [
    ['member:spawn:2', 'member', '八字复核'], ['tool:status', 'tool', '后台子分析'],
  ]);
  assert.equal(getAgentWorkspaceAutoOpenEvent([running, status]), null, 'subagents have no board: neither starting nor checking on them opens the workspace');
});
