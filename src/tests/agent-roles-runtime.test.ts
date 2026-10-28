import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import {
  createAssistantMessageEventStream, getCurrentTools,
  type Api, type AssistantMessage, type AssistantMessageEventStream, type JsonObject, type Message, type Model,
} from '@earendil-works/pi-ai';
import type { AgentPart, PiStreamFn } from '../lib/agent/types';
import type { AgentRunRow } from '../lib/agent/store.server';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { emptyPiAssistant } from '../lib/agent/pi-stream.server';
import { parallelAnalysisResults } from '../lib/agent/parallel-results';
import { BUILTIN_AGENT_PROFILES, type AgentProfileView } from '../lib/agent/profiles/config';
import { AGENT_MEMBER_DENIED_TOOLS } from '../lib/agent/tool-catalog';
import { config, MemoryStore, row } from './helpers/agent-runtime-fixture';

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

const BAZI = { birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, gender: 'male' };
const REPORT = /^\[后台子分析「.+?」回报\]/u;
const ROLE_MODEL = { ...config, id: 'role-model', name: '角色模型' };
/** A custom role reading the user's data and the knowledge base, with its own model. */
const ARCHIVIST: AgentProfileView = {
  name: 'archivist', builtin: false, displayName: '档案员', description: '整理用户资料与知识库条目', instructions: '只整理资料，不下结论。',
  tools: { inherit: false, allow: ['data', 'knowledge'], deny: ['read_attachment'] }, skills: [], model: ROLE_MODEL.id, reasoningEffort: null,
  modes: ['parallel', 'background'], requiredTier: 'free', enabled: true, sortOrder: 0, updatedAt: null,
};
const PROFILES = [...BUILTIN_AGENT_PROFILES, ARCHIVIST];

const textOf = (message: Message | undefined) => !message ? ''
  : typeof message.content === 'string' ? message.content
  : message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
const results = (messages: readonly Message[], name: string) => messages.filter(message => message.role === 'toolResult' && message.toolName === name);
const offered = (messages: readonly Message[]) => getCurrentTools(messages).map(tool => tool.name);
const say = (text: string): AssistantMessage['content'] => [{ type: 'text', text }];
const call = (id: string, name: string, args: JsonObject) => ({ type: 'toolCall' as const, id, name, arguments: args });

function respond(model: Model<Api>, content: AssistantMessage['content']): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
  message.content = content;
  message.stopReason = content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop';
  message.usage.input = 10;
  message.usage.totalTokens = 10;
  output.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
  output.end(message);
  return output;
}

const finished = (store: MemoryStore) => store.writes.findLast(write => write.name === 'agent_finish_run')!;
const finalCheckpoint = (store: MemoryStore) => finished(store).args.p_checkpoint as AgentRunRow['checkpoint'];
const toolCards = (parts: AgentPart[], name: string) => parts.filter((part): part is Extract<AgentPart, { type: 'tool' }> => part.type === 'tool' && part.name === name);
const timers = () => process.getActiveResourcesInfo().filter(resource => resource === 'Timeout').length;

test('members work as the roles the main agent gives them, with only the tools and model each role grants', { timeout: 30000 }, async () => {
  const store = new MemoryStore(), run = row();
  const members = new Map<string, { model: string; tools: string[]; refused?: Message }>();
  const before = timers();
  const streamFn: PiStreamFn = (model, context) => {
    const tools = offered(context.messages);
    if (tools.includes('parallel_analysis')) {
      if (results(context.messages, 'parallel_analysis').length) return respond(model, say('三位成员的资料已核对汇总。'));
      return respond(model, [call('parallel', 'parallel_analysis', { title: '分头整理', tasks: [
        { agent: 'archivist', name: '档案整理', question: '整理用户已存的命盘与笔记' },
        { system: 'ziwei', question: `看紫微命盘的事业宫：${JSON.stringify(BAZI)}` },
        { agent: 'researcher', question: '检索知识库里关于化忌的说法' },
      ] })]);
    }
    const question = textOf(context.messages.find(message => message.role === 'user'));
    const key = question.includes('整理用户') ? 'archivist' : question.includes('紫微') ? 'specialist' : 'researcher';
    const refused = results(context.messages, 'bazi')[0];
    members.set(key, { model: model.id, tools, ...(refused ? { refused } : {}) });
    // The archivist tries a Core tool its role does not grant before answering.
    if (key === 'archivist' && !refused) return respond(model, [call('chart', 'bazi', BAZI)]);
    return respond(model, say(`${key} 的结论。`));
  };
  await executeAgentRun(store, run, undefined, { config, configs: [ROLE_MODEL], profiles: PROFILES, streamFn });
  assert.equal(finished(store).args.p_status, 'completed');

  const archivist = members.get('archivist')!, specialist = members.get('specialist')!, researcher = members.get('researcher')!;
  assert.deepEqual(archivist.tools.toSorted(), ['list_user_data', 'read_user_data', 'read_user_notes', 'read_user_profile', 'search_knowledge']);
  assert.equal(archivist.model, ROLE_MODEL.id, 'a role with its own model runs on it');
  assert.equal(archivist.refused?.role === 'toolResult' && archivist.refused.isError, true);
  assert.match(textOf(archivist.refused), /not available/, 'pi refuses a tool the member was not offered');
  assert.equal([...store.drafts.values()].filter(draft => draft.tool_name === 'bazi').length, 0, 'the refused call ran nothing');

  assert.deepEqual(specialist.tools.toSorted(), ['load_skill', 'ziwei', 'ziwei_flying_star', 'ziwei_horoscope', 'ziwei_palace']);
  assert.equal(specialist.model, config.id);
  assert.ok(researcher.tools.includes('search_knowledge'));
  for (const tools of [archivist.tools, specialist.tools, researcher.tools]) {
    assert.deepEqual(tools.filter(tool => AGENT_MEMBER_DENIED_TOOLS.has(tool)), []);
    assert.ok(!tools.includes('bazi') || tools === specialist.tools);
  }

  const [card] = toolCards(finalCheckpoint(store).parts, 'parallel_analysis');
  assert.deepEqual(parallelAnalysisResults(card.output).map(member => [member.name, member.profile, member.profileName, member.system, member.model, member.status]), [
    ['档案整理', 'archivist', '档案员', undefined, ROLE_MODEL.id, 'completed'],
    [undefined, 'specialist', '体系专家', 'ziwei', undefined, 'completed'],
    [undefined, 'researcher', '研究员', undefined, undefined, 'completed'],
  ]);
  assert.ok(timers() <= before, 'following members leaves no timers behind');
});

test('a collaboration member keeps the role its user set, and a task naming another role for it fails', { timeout: 30000 }, async () => {
  const store = new MemoryStore(), run = row();
  run.input.collaborators = [{ id: 'notes', name: '笔记整理', model: 'member-model', focus: '', reasoning: false, reasoningEffort: null, profile: 'archivist' }];
  const memberModel = { ...config, id: 'member-model', name: '成员模型' };
  const seen: Array<{ model: string; tools: string[] }> = [];
  let attempt = 0;
  const streamFn: PiStreamFn = (model, context) => {
    const tools = offered(context.messages);
    if (tools.includes('parallel_analysis')) {
      if (results(context.messages, 'parallel_analysis').some(result => result.role === 'toolResult' && !result.isError)) return respond(model, say('已汇总。'));
      // First as another role, which the user did not set; then as the user set it.
      const agent: JsonObject = attempt++ === 0 ? { agent: 'researcher' } : {};
      return respond(model, [call(`parallel-${attempt}`, 'parallel_analysis', { tasks: [{ agentId: 'notes', ...agent, question: '整理用户资料' }] })]);
    }
    seen.push({ model: model.id, tools });
    return respond(model, say('资料已整理。'));
  };
  await executeAgentRun(store, run, undefined, { config, configs: [memberModel, ROLE_MODEL], profiles: PROFILES, streamFn });
  assert.equal(finished(store).args.p_status, 'completed');
  const [refused, accepted] = toolCards(finalCheckpoint(store).parts, 'parallel_analysis');
  assert.equal(refused.status, 'failed');
  assert.match(JSON.stringify([refused.output, refused.canonicalText]), /角色由用户设为 archivist/);
  assert.equal(accepted.status, 'completed');
  assert.deepEqual(seen.map(item => item.model), [ROLE_MODEL.id], 'the role\'s own model replaces the one the user gave the member');
  assert.deepEqual(parallelAnalysisResults(accepted.output).map(member => [member.agentId, member.name, member.profileName, member.model]),
    [['notes', '笔记整理', '档案员', ROLE_MODEL.id]]);
});

test('a background subagent works as a role without a system, and the next task recreates it with that role', { timeout: 30000 }, async () => {
  const store = new MemoryStore(), run = row();
  const offers: string[][] = [];
  const before = timers();
  const streamFn: PiStreamFn = (model, context) => {
    const tools = offered(context.messages);
    if (tools.includes('background_agent')) {
      const input = context.messages.findLast(message => message.role !== 'system');
      if (input?.role === 'user' && REPORT.test(textOf(input))) return respond(model, say('资料员的回报已整合。'));
      if (!results(context.messages, 'background_agent').length)
        return respond(model, [call('spawn', 'background_agent', { action: 'spawn', name: '资料员', agent: 'researcher', message: '检索知识库里关于化忌的说法' })]);
      return respond(model, say('资料员在后台检索，结论稍后整合。'));
    }
    offers.push(tools);
    return respond(model, say('知识库：化忌主执着。'));
  };
  await executeAgentRun(store, run, undefined, { config, configs: [ROLE_MODEL], profiles: PROFILES, streamFn });
  assert.equal(finished(store).args.p_status, 'completed');
  const checkpoint = finalCheckpoint(store);
  const [card] = toolCards(checkpoint.parts, 'background_agent');
  assert.equal(card.status, 'completed');
  assert.deepEqual([(card.output as { profile?: string }).profile, (card.output as { profileName?: string }).profileName], ['researcher', '研究员']);
  assert.ok(offers.length && offers.every(tools => tools.includes('search_knowledge') && !tools.some(tool => tool === 'bazi' || AGENT_MEMBER_DENIED_TOOLS.has(tool))));
  assert.deepEqual(checkpoint.background?.map(item => [item.name, item.profile, item.system]), [['资料员', 'researcher', undefined]]);
  assert.ok(timers() <= before, 'watching subagents leaves no timers behind');

  // The next question: the kept researcher is listed with its role and takes the new message.
  const nextStore = new MemoryStore(), next = row();
  next.checkpoint.background = checkpoint.background;
  let listed = false;
  const resumed: string[][] = [];
  const nextStream: PiStreamFn = (model, context) => {
    const tools = offered(context.messages);
    if (tools.includes('background_agent')) {
      listed ||= JSON.stringify(context.messages).includes('资料员（研究员）');
      const input = context.messages.findLast(message => message.role !== 'system');
      if (input?.role === 'user' && REPORT.test(textOf(input))) return respond(model, say('已整合。'));
      if (!results(context.messages, 'background_agent').length)
        return respond(model, [call('send', 'background_agent', { action: 'send', name: '资料员', message: '再查化禄' })]);
      return respond(model, say('已交给资料员。'));
    }
    resumed.push(tools);
    return respond(model, say('知识库：化禄主得。'));
  };
  await executeAgentRun(nextStore, next, undefined, { config, configs: [ROLE_MODEL], profiles: PROFILES, streamFn: nextStream });
  assert.equal(finished(nextStore).args.p_status, 'completed');
  assert.ok(listed, 'the main agent sees the kept subagent with its role');
  assert.ok(resumed.length && resumed.every(tools => tools.includes('search_knowledge') && !tools.includes('bazi')));

  // A role switched off since: the subagent is not recreated.
  const laterStore = new MemoryStore(), later = row();
  later.checkpoint.background = checkpoint.background;
  await executeAgentRun(laterStore, later, undefined, { config, configs: [ROLE_MODEL], profiles: PROFILES.filter(profile => profile.name !== 'researcher'), streamFn: (model, context) => {
    assert.ok(!JSON.stringify(context.messages).includes('资料员（'), 'a subagent whose role is off is not offered');
    return respond(model, say('直接回答。'));
  } });
  assert.equal(finished(laterStore).args.p_status, 'completed');
  assert.equal(finalCheckpoint(laterStore).background, undefined);
});
