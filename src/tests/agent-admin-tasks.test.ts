import test, { beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { MockLanguageModelV3 } from 'ai/test';
import {
  createAssistantMessageEventStream, getCurrentTools,
  type Api, type AssistantMessage, type AssistantMessageEventStream, type Message, type Model,
} from '@earendil-works/pi-ai';
import type { StorageWrite } from '@earendil-works/pi-durable';
import type { PiStreamFn } from '../lib/agent/types';
import type { AgentTaskConversation, AgentTaskNode, AgentTaskTree } from '../lib/agent/admin-tasks';
import { buildAgentTaskTree, countBlockingAgentRuns, type AgentTaskLogCommit } from '../lib/agent/admin-tasks.server';
import { AGENT_ACTIVE_STATUSES } from '../lib/agent/types';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { emptyPiAssistant } from '../lib/agent/pi-stream.server';
import { GET as listRoute } from '../app/api/admin/agent-runs/route';
import { GET as treeRoute } from '../app/api/admin/agent-runs/[id]/route';
import { config, MemoryStore, row } from './helpers/agent-runtime-fixture';
import { createMockScopedDb } from './helpers/db-mock';

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

const textOf = (message: Message | undefined) => !message ? ''
  : typeof message.content === 'string' ? message.content
  : message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
const results = (messages: readonly Message[], name: string) => messages.filter(message => message.role === 'toolResult' && message.toolName === name);
const isMain = (messages: readonly Message[]) => getCurrentTools(messages).some(tool => tool.name === 'background_agent');
const reportTurn = (messages: readonly Message[]) => {
  const input = messages.findLast(message => message.role !== 'system');
  return input?.role === 'user' && REPORT.test(textOf(input));
};

function respond(model: Model<Api>, content: AssistantMessage['content']): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
  message.content = content;
  message.stopReason = content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop';
  output.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
  output.end(message);
  return output;
}

/** What `agent_admin_task_log` keeps of a write (database/functions.sql): the tree may read nothing else. */
function kept(write: StorageWrite): StorageWrite[] {
  if (write.type === 'conversation' || write.type === 'submission') return [write];
  if (write.type === 'task') {
    const value: Record<string, unknown> = { ...write.value };
    delete value.memos;
    return [{ type: 'task', value } as unknown as StorageWrite];
  }
  if (write.type !== 'entry') return [];
  const content = (write.value.model ?? []).flatMap(message => message.role !== 'assistant' ? []
    : message.content.flatMap(part => part.type === 'toolCall' ? [{ type: 'toolCall', id: part.id, name: part.name }] : []));
  if (!content.length) return [];
  const { id, conversationId, kind } = write.value;
  return [{ type: 'entry', value: { id, conversationId, kind, model: [{ role: 'assistant', content }] } } as unknown as StorageWrite];
}

const logOf = (store: MemoryStore): AgentTaskLogCommit[] =>
  store.log.map(commit => ({ sequence: commit.sequence, at: new Date(Date.UTC(2026, 9, 21, 0, 0, 0, commit.sequence)).toISOString(), writes: commit.writes.flatMap(kept) }));
/** A conversation's own tasks, not those of the conversations its tasks own. */
const ownTasks = (conversation: AgentTaskConversation): AgentTaskNode[] => {
  const visit = (node: AgentTaskNode): AgentTaskNode[] => [node, ...node.tasks.flatMap(visit)];
  return conversation.tasks.flatMap(visit);
};
const everyConversation = (conversations: readonly AgentTaskConversation[]): AgentTaskConversation[] => conversations.flatMap(conversation =>
  [conversation, ...everyConversation(ownTasks(conversation).flatMap(node => node.conversations))]);
const everyTask = (tree: AgentTaskTree) => everyConversation(tree.conversations).flatMap(ownTasks);

test('a run\'s tree shows its model calls, tool calls, a member\'s and a subagent\'s conversations, and what waited on what', { timeout: 30000 }, async () => {
  const store = new MemoryStore(), run = row();
  const streamFn: PiStreamFn = (model, context) => {
    if (isMain(context.messages)) {
      if (reportTurn(context.messages)) return respond(model, [{ type: 'text', text: '综合八字复核的回报：事业平稳。' }]);
      if (!results(context.messages, 'background_agent').length) return respond(model, [
        { type: 'toolCall', id: 'chart', name: 'bazi', arguments: BAZI },
        { type: 'toolCall', id: 'spawn', name: 'background_agent', arguments: { action: 'spawn', name: '八字复核', system: 'bazi', message: `请复核：${JSON.stringify(BAZI)}` } },
      ]);
      if (!results(context.messages, 'parallel_analysis').length)
        return respond(model, [{ type: 'toolCall', id: 'team', name: 'parallel_analysis', arguments: { tasks: [{ system: 'bazi', question: `看事业：${JSON.stringify(BAZI)}`, name: '事业' }] } }]);
      return respond(model, [{ type: 'text', text: '主分析完成，八字复核的结论稍后整合。' }]);
    }
    if (!results(context.messages, 'bazi').length) return respond(model, [{ type: 'toolCall', id: 'member-chart', name: 'bazi', arguments: BAZI }]);
    return respond(model, [{ type: 'text', text: JSON.stringify(context.messages).includes('请复核') ? '复核结论：日主庚金。' : '事业结论：平稳。' }]);
  };
  await executeAgentRun(store, run, undefined, { config, streamFn });
  assert.equal(store.writes.findLast(write => write.name === 'agent_finish_run')?.args.p_status, 'completed');

  const log = logOf(store);
  const tree = buildAgentTaskTree(log);
  assert.deepEqual([tree.commits, tree.lastCommitAt, tree.truncated], [log.length, log.at(-1)!.at, false]);
  assert.deepEqual(tree.conversations.map(conversation => conversation.role), ['main']);
  const [main] = tree.conversations;
  const mainTasks = ownTasks(main);
  const tool = (name: string) => mainTasks.find(node => node.role === 'tool' && node.tool === name);
  for (const name of ['bazi', 'background_agent', 'parallel_analysis']) {
    const call = tool(name);
    assert.ok(call, name);
    assert.ok(mainTasks.some(node => node.role === 'generation' && node.tasks.includes(call)), `${name} sits under the model call that made it`);
  }
  const team = tool('parallel_analysis')!;
  assert.deepEqual(team.conversations.map(conversation => conversation.role), ['member']);
  const [member] = team.conversations;
  assert.ok(ownTasks(member).some(node => node.role === 'tool' && node.tool === 'bazi'), 'a member\'s calls sit in its own conversation');
  assert.ok(member.submissions.some(submission => submission.requestId === `analysis:${team.id}:0` && submission.status === 'done'));

  const holder = main.tasks.find(node => node.role === 'subagent');
  assert.deepEqual([holder?.background, holder?.outcome], [true, 'completed']);
  const [subagent] = holder!.conversations;
  assert.deepEqual([subagent.role, subagent.name], ['subagent', '八字复核']);
  assert.ok(ownTasks(subagent).some(node => node.role === 'tool' && node.tool === 'bazi'));
  assert.ok(subagent.submissions.some(submission => submission.requestId?.startsWith('background:') && submission.status === 'done'), 'the message reached the subagent');
  assert.deepEqual(main.tasks.filter(node => node.role === 'report').map(node => [node.subagent, node.background, node.outcome]), [['八字复核', true, 'completed']]);
  assert.ok(main.submissions.some(submission => submission.requestId === 'initial' && submission.status === 'done'));
  assert.ok(main.submissions.some(submission => submission.requestId?.startsWith('background-report:') && submission.status === 'done'), 'the report reached the main conversation');

  const tasks = everyTask(tree);
  assert.deepEqual(tree.counts, { live: 0, completed: tasks.length, failed: 0, aborted: 0 });
  assert.ok(tasks.every(node => node.status === 'terminal' && node.startedAt !== undefined && node.endedAt! >= node.startedAt), 'every task ran and ended');
  // Read part way, the log shows the live graph: the model call waits on the calls it made.
  const waiting = log.map((_, index) => buildAgentTaskTree(log.slice(0, index + 1)))
    .flatMap(partial => everyTask(partial)).find(node => node.role === 'generation' && node.status === 'waiting');
  assert.ok(waiting, 'a model call waited on its tools');
  assert.equal(waiting.phase, 'tools');
  assert.ok(waiting.waitingOn?.length && waiting.waitingOn.every(id => waiting.tasks.some(child => child.id === id)));
});

const at = (second: number) => new Date(Date.UTC(2026, 9, 21, 0, 0, second)).toISOString();
const taskWrite = (value: Record<string, unknown>) =>
  ({ type: 'task', value: { conversationId: 1, version: 1, input: {}, background: false, abortRequested: false, ...value } });

test('the tree keeps each record\'s latest write, names script calls, failures and restarts, and keeps tasks whose owner it did not read', () => {
  const first = [
    { type: 'conversation', value: { id: 1 } },
    { type: 'conversation', value: { id: 2, parent: { conversationId: 1, at: 3 } } },
    { type: 'entry', value: { id: 3, conversationId: 1, kind: 'pi.assistant', model: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'codemode' }] }] } },
    taskWrite({ id: 10, kind: 'pi.generation', startedAt: 1000, state: { status: 'waiting', checkpoint: { phase: 'tools', assistant: 3, tools: [11], pending: [] }, on: [11], policy: 'failFast' } }),
    taskWrite({ id: 11, kind: 'pi.tool', owner: 10, startedAt: 1100, input: { kind: 'model', assistant: 3, callId: 'c1' }, state: { status: 'running', checkpoint: { phase: 'execute', arguments: {}, replay: 'safe' } } }),
    taskWrite({ id: 12, kind: 'pi.tool', owner: 11, input: { kind: 'nested', parent: 11, parentCallId: 'c1', key: 'k', call: { type: 'toolCall', id: 'c1/c1', name: 'bazi', arguments: {} } }, state: { status: 'pending', checkpoint: { phase: 'call' } } }),
    taskWrite({ id: 13, kind: 'pi.generation', abortRequested: true, abortReason: 'restart', state: { status: 'running', checkpoint: { phase: 'request', attempt: 2, model: { provider: 'taibu', modelId: 'deepseek' }, thinkingLevel: 'off', streamOptions: {}, cutoff: 3 } } }),
    taskWrite({ id: 14, kind: 'pi.compaction', startedAt: 1500, endedAt: 1600, state: { status: 'terminal', outcome: { status: 'aborted', reason: 'user' } } }),
    taskWrite({ id: 15, kind: 'custom.kind', owner: 99, state: { status: 'pending', checkpoint: { phase: 'start' } } }),
    taskWrite({ id: 16, conversationId: 2, kind: 'pi.generation', state: { status: 'terminal', outcome: { status: 'faulted', error: { message: `boom${'x'.repeat(3000)}` } } } }),
    { type: 'submission', value: { id: 20, conversationId: 1, type: 'input', status: 'unanswered', requestId: 'command:3', reason: 'model_error', detail: 'Compaction failed: 超时' } },
    { type: 'submission', value: { id: 21, conversationId: 2, type: 'write', status: 'done', entry: 5 } },
  ];
  const second = [taskWrite({ id: 12, kind: 'pi.tool', owner: 11, startedAt: 1200, endedAt: 1300,
    input: { kind: 'nested', parent: 11, parentCallId: 'c1', key: 'k', call: { type: 'toolCall', id: 'c1/c1', name: 'bazi', arguments: {} } },
    state: { status: 'terminal', outcome: { status: 'failed', error: { message: '参数无效' } } } })];
  const commits = [{ sequence: 1, at: at(1), writes: first }, { sequence: 2, at: at(2), writes: second }] as unknown as AgentTaskLogCommit[];
  const tree = buildAgentTaskTree(commits, true);
  assert.deepEqual([tree.commits, tree.lastCommitAt, tree.truncated], [2, at(2), true]);
  assert.deepEqual(tree.conversations.map(conversation => [conversation.id, conversation.role, conversation.forkOf]), [[1, 'main', undefined], [2, 'fork', 1]]);
  const [main, fork] = tree.conversations;
  assert.deepEqual(main.tasks.map(node => node.id), [10, 13, 14, 15], 'a task whose owner the read missed stays under its conversation');
  const [generation, retried, compaction, other] = main.tasks;
  assert.deepEqual([generation.status, generation.phase, generation.waitingOn, generation.policy], ['waiting', 'tools', [11], 'failFast']);
  const [script] = generation.tasks;
  assert.deepEqual([script.id, script.role, script.tool, script.nested, script.status, script.phase], [11, 'tool', 'codemode', undefined, 'running', 'execute']);
  const [call] = script.tasks;
  assert.deepEqual([call.id, call.tool, call.nested, call.outcome, call.reason, call.changedAt, call.endedAt! - call.startedAt!], [12, 'bazi', true, 'failed', '参数无效', at(2), 100],
    'the latest write wins');
  assert.deepEqual([retried.attempt, retried.model, retried.phase, retried.abortRequested, retried.abandoned], [2, 'deepseek', 'request', true, true]);
  assert.deepEqual([compaction.role, compaction.outcome, compaction.reason], ['compaction', 'aborted', 'user']);
  assert.deepEqual([other.role, other.kind, other.status], ['other', 'custom.kind', 'pending']);
  assert.deepEqual(main.submissions, [{ id: 20, type: 'input', status: 'unanswered', requestId: 'command:3', reason: 'model_error', detail: 'Compaction failed: 超时' }]);
  assert.deepEqual(fork.submissions, [{ id: 21, type: 'write', status: 'done' }]);
  assert.deepEqual([fork.tasks[0].outcome, fork.tasks[0].reason?.length, fork.tasks[0].reason?.startsWith('boom')], ['faulted', 2000, true]);
  assert.deepEqual(tree.counts, { live: 4, completed: 0, failed: 2, aborted: 1 });
  assert.deepEqual(buildAgentTaskTree([]), { commits: 0, lastCommitAt: null, truncated: false, conversations: [], counts: { live: 0, completed: 0, failed: 0, aborted: 0 } });
});

test('blocking tasks exclude durable pauses', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const db = createMockScopedDb({
    tx: async (work: (trx: never) => unknown) => work({
      selectFrom() {
        const query = {
          select(callback?: (builder: unknown) => unknown) {
            callback?.({ fn: { countAll: () => ({ as: () => 'count' }) } });
            return query;
          },
          where(...args: unknown[]) { calls.push({ method: 'where', args }); return query; },
          async executeTakeFirst() { return { count: '2' }; },
        };
        return query;
      },
    } as never),
  });
  assert.equal(await countBlockingAgentRuns(db), 2);
  assert.deepEqual(calls, [{ method: 'where', args: ['status', 'in', ['queued', 'running', 'cancelling']] }]);
  assert.ok(AGENT_ACTIVE_STATUSES.includes('awaiting_input'), 'the admin list keeps showing paused tasks');
});

const RUN = randomUUID(), CONVERSATION = randomUUID(), USER = randomUUID();
const runInput = {
  title: '看事业', model: 'deepseek', codeMode: true, planMode: null, compact: null, webEnabled: false, collaborators: [{ id: 'a' }, { id: 'b' }],
};
const runRow = (overrides: Record<string, unknown> = {}) => ({
  id: RUN, conversation_id: CONVERSATION, user_id: USER, status: 'running', billing: 'charged', worker_id: 'worker-a', fence: 3,
  lease_until: '2026-10-21T00:01:00.000Z', cancel_requested: false, created_at: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-21T00:00:30.000Z',
  input: runInput, ...overrides,
});

function adminFixture(t: TestContext, { admin = true }: { admin?: boolean } = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const state = { rows: [runRow()] as unknown[], logPages: [[]] as unknown[][], logError: null as { message: string } | null, emailError: false };
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        const query = {
          select() { return query; },
          where(...args: unknown[]) { calls.push({ table, method: 'where', args }); return query; },
          orderBy(...args: unknown[]) { calls.push({ table, method: 'orderBy', args }); return query; },
          limit(...args: unknown[]) { calls.push({ table, method: 'limit', args }); return query; },
          async executeTakeFirst() { return state.rows[0]; },
          async execute() { return state.rows; },
        };
        return query;
      },
    } as never),
    rpc: async (name, args) => {
      rpcs.push({ name, args });
      if (name === 'admin_get_auth_user_emails') {
        if (state.emailError) throw new Error('denied');
        return [{ user_id: USER, email: 'user@example.com' }];
      }
      if (name === 'agent_admin_task_log') {
        if (state.logError) throw new Error(state.logError.message);
        return state.logPages.shift() ?? [];
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  });
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const context = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  let clients = 0;
  t.mock.method(api, 'requireAdminUser', async () => (admin ? { user: { id: 'admin' } } : { error: { message: '无权限操作', status: 403 } }) as Awaited<ReturnType<typeof api.requireAdminUser>>);
  const originalSystemDb = context.systemDb;
  context.systemDb = (() => { clients++; return scoped; }) as typeof context.systemDb;
  t.after(() => { context.systemDb = originalSystemDb; });
  return { calls, rpcs, state, clients: () => clients };
}
const listRequest = (query = '') => new NextRequest(`http://localhost/api/admin/agent-runs${query}`);
const treeRequest = (id: string) => [new NextRequest(`http://localhost/api/admin/agent-runs/${id}`), { params: Promise.resolve({ id }) }] as const;

test('the task list reads active tasks newest first, names their users, and finds any task by ID', async t => {
  const f = adminFixture(t);
  const response = await listRoute(listRequest());
  assert.equal(response.status, 200);
  const { runs } = await response.json();
  assert.deepEqual(runs, [{
    id: RUN, conversationId: CONVERSATION, userId: USER, userEmail: 'user@example.com', status: 'running', billing: 'charged', title: '看事业', model: 'deepseek',
    modes: { codeMode: true, planMode: false, compact: false, web: false, collaborators: 2 },
    workerId: 'worker-a', fence: 3, leaseUntil: '2026-10-21T00:01:00.000Z', cancelRequested: false, createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:30.000Z',
  }]);
  const filters = () => f.calls.map(call => [call.method, ...call.args]);
  assert.deepEqual(filters(), [['where', 'status', 'in', ['queued', 'running', 'awaiting_input', 'cancelling']], ['orderBy', 'updated_at', 'desc'], ['limit', 50]]);
  assert.deepEqual(f.rpcs, [{ name: 'admin_get_auth_user_emails', args: { p_user_ids: [USER] } }]);

  f.calls.length = 0;
  await listRoute(listRequest('?scope=recent'));
  assert.deepEqual(filters(), [['orderBy', 'updated_at', 'desc'], ['limit', 50]], 'recent tasks in every state');
  f.calls.length = 0;
  await listRoute(listRequest('?scope=blocking'));
  assert.deepEqual(filters(), [['where', 'status', 'in', ['queued', 'running', 'cancelling']], ['orderBy', 'updated_at', 'desc'], ['limit', 50]], 'only the tasks an update would interrupt');
  f.calls.length = 0;
  f.state.emailError = true;
  f.state.rows = [runRow({ input: { ...runInput, compact: { instructions: null } }, status: 'completed' })];
  const found = await (await listRoute(listRequest(`?q=${CONVERSATION}`))).json();
  const search = filters().find(([method]) => method === 'where') as [string, (builder: unknown) => unknown];
  assert.equal(search[0], 'where');
  assert.equal(typeof search[1], 'function', 'a search uses an OR predicate');
  assert.deepEqual([found.runs[0].userEmail, found.runs[0].modes.compact], [null, true], 'a failed account lookup leaves the email out');
});

test('the task list refuses non-administrators and partial IDs before reading', async t => {
  const denied = adminFixture(t, { admin: false });
  const response = await listRoute(listRequest());
  assert.deepEqual([response.status, (await response.json()).error], [403, '无权限操作']);
  const tree = await treeRoute(...treeRequest(RUN));
  assert.equal(tree.status, 403);
  assert.equal(denied.clients(), 0, 'no database client for a refused caller');
  t.mock.restoreAll();
  const f = adminFixture(t);
  const partial = await listRoute(listRequest('?q=abc'));
  assert.deepEqual([partial.status, (await partial.json()).error], [400, '请输入完整的任务、对话或用户 ID']);
  const invalid = await treeRoute(...treeRequest('not-a-run'));
  assert.equal(invalid.status, 400);
  assert.equal(f.clients(), 0);
});

test('a task tree reads the whole log page by page, and reports a missing task or a failed read', async t => {
  const f = adminFixture(t);
  const commit = (sequence: number) => ({ sequence, at: at(sequence % 60), writes: sequence === 1 ? [{ type: 'conversation', value: { id: 1 } }] : [] });
  f.state.logPages = [Array.from({ length: 200 }, (_, index) => commit(index + 1)), [commit(201)]];
  const response = await treeRoute(...treeRequest(RUN));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.run.id, RUN);
  assert.equal(body.cost, null, 'a failed billing lookup does not hide the task');
  assert.deepEqual([body.tree.commits, body.tree.truncated, body.tree.conversations.map((conversation: AgentTaskConversation) => conversation.role)], [201, false, ['main']]);
  assert.deepEqual(f.rpcs.filter(rpc => rpc.name === 'agent_admin_task_log').map(rpc => rpc.args), [{ p_run_id: RUN, p_after: 0 }, { p_run_id: RUN, p_after: 200 }]);
  assert.deepEqual(f.calls.filter(call => call.method === 'where').map(call => call.args), [['id', '=', RUN]]);

  f.state.rows = [];
  const missing = await treeRoute(...treeRequest(randomUUID()));
  assert.deepEqual([missing.status, (await missing.json()).error], [404, '任务不存在']);
  f.state.rows = [runRow()];
  f.state.logError = { message: 'AGENT_ADMIN_REQUIRED' };
  const failed = await treeRoute(...treeRequest(RUN));
  assert.deepEqual([failed.status, (await failed.json()).error], [500, '读取任务树失败']);
});

test('the task detail reports what its model calls cost', async t => {
  const f = adminFixture(t);
  f.state.logPages = [[]];
  const ledger = require('../lib/billing/ledger.server') as typeof import('../lib/billing/ledger.server');
  const costs = t.mock.method(ledger, 'referenceCosts', async () => new Map([[RUN, { calls: 4, spentMicros: 15_000 }]]));
  const response = await treeRoute(...treeRequest(RUN));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).cost, { calls: 4, spentMicros: 15_000 });
  const args = costs.mock.calls[0]?.arguments;
  assert.deepEqual(args?.slice(0, 2), ['agent_run', [RUN]]);
  assert.ok(args?.[2], 'the cost is read through the caller scoped database');
});
