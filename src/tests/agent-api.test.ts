import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { TestContext } from "node:test";
import { createMockAuthContext } from "./helpers/auth-mock";
import { createMockScopedDb } from "./helpers/db-mock";
import { AgentStore, type AgentRunRow } from "../lib/agent/store.server";
import { AGENT_ENGINE } from "../lib/agent/engine";
import {
  agentEndpoint,
  agentCapabilities,
  createAgentTask,
  getAgentTask,
  controlAgentTask,
  streamAgentTask,
  hashAgentRequest,
} from "../lib/agent/api.server";
import type { AIModelConfig } from "../types";
import { DEFAULT_AGENT_EXTENSIONS_POLICY } from "../lib/agent/mcp/config";
import { DEFAULT_BYOK_POLICY } from "../lib/byok/config";
import type { ResolvedByokModel } from "../lib/byok/store.server";
import type { FeatureModuleState } from "../lib/app-settings";

const model: AIModelConfig = {
  id: "fixture",
  name: "fixture",
  vendor: "other",
  modelId: "fixture",
  apiUrl: "https://model.example/v1",
  supportsReasoning: true,
  pricing: { input: 1, output: 2, cacheRead: null, cacheWrite: null, image: null },
};
const OWN_CONNECTION = "00000000-0000-4000-8000-0000000000c1";
function ownModel(id: string, overrides: Partial<ResolvedByokModel> = {}): ResolvedByokModel {
  return {
    id, ref: `byok:${id}`, modelId: "deepseek-chat", displayName: "我的 DeepSeek", usage: "chat", supportsVision: false,
    thinkingLevels: [], defaultEffort: "medium", contextWindow: null, maxOutput: null,
    connection: { id: OWN_CONNECTION, name: "DeepSeek", protocol: "openai", baseUrl: "https://api.deepseek.com", keyHint: null, updatedAt: "2026-11-02T00:00:00Z" },
    serverKey: false, openKey: () => null, ...overrides,
  };
}
const OWN_CHAT = ownModel("00000000-0000-4000-8000-0000000000b1");
const OWN_IMAGE = ownModel("00000000-0000-4000-8000-0000000000b2", { modelId: "gpt-image-1", displayName: "gpt-image-1", usage: "image", defaultEffort: "auto" });
const OWN_STORED = ownModel("00000000-0000-4000-8000-0000000000b3", {
  serverKey: true, openKey: () => "sk-stored",
  connection: { ...OWN_CHAT.connection, id: "00000000-0000-4000-8000-0000000000c2", keyHint: "sk-…ored" },
});
/** The member's own models the account has; the references a task names resolve against these. */
function ownModels(t: TestContext, models: ResolvedByokModel[] = [OWN_CHAT, OWN_IMAGE, OWN_STORED]) {
  const store = require("../lib/byok/store.server") as typeof import("../lib/byok/store.server");
  const settings = require("../lib/app-settings") as typeof import("../lib/app-settings");
  t.mock.method(settings, "getByokPolicy", async () => DEFAULT_BYOK_POLICY);
  return t.mock.method(store, "resolveByokModels", async (_db: unknown, _user: string, refs: readonly string[]) =>
    new Map(models.filter(model => refs.includes(model.ref)).map(model => [model.ref, model])));
}

function setup(t: TestContext, messages: unknown[] = []) {
  const owner = randomUUID(),
    conversation = randomUUID(),
    writes: Array<{ name: string; args: Record<string, unknown> }> = [];
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        const query = {
          select() { return query; },
          selectAll() { return query; },
          where() { return query; },
          orderBy() { return query; },
          limit() { return query; },
          async executeTakeFirst() {
            return table === 'conversations' ? { id: conversation, messages, title: 'fixture' } : undefined;
          },
          async execute() { return []; },
        };
        return query;
      },
    } as never),
    rpc: async () => { throw new Error('unexpected agent rpc in this test'); },
  });
  const api = require("../lib/api-utils") as typeof import("../lib/api-utils");
  const features =
    require("../lib/app-settings") as typeof import("../lib/app-settings");
  const aiGuard =
    require("../lib/api/ai-feature-guard") as typeof import("../lib/api/ai-feature-guard");
  const configs =
    require("../lib/server/ai-config") as typeof import("../lib/server/ai-config");
  const context =
    require("../lib/server/chat/prompt-context") as typeof import("../lib/server/chat/prompt-context");
  const billing =
    require("../lib/billing/account.server") as typeof import("../lib/billing/account.server");
  const rate =
    require("../lib/rate-limit") as typeof import("../lib/rate-limit");
  t.mock.method(api, "requireUserContext", async () =>
    createMockAuthContext(owner, scoped),
  );
  const contextModule = require("../lib/db/context.server") as typeof import("../lib/db/context.server");
  const originalSystemDb = contextModule.systemDb;
  contextModule.systemDb = (() => scoped) as typeof contextModule.systemDb;
  t.after(() => { contextModule.systemDb = originalSystemDb; });
  t.mock.method(
    features,
    "readFeatureModuleStateFresh",
    async () =>
      ({ status: "enabled" }) as Awaited<
        ReturnType<typeof features.readFeatureModuleStateFresh>
      >,
  );
  t.mock.method(aiGuard, "getGlobalAIFeatureGuardResponse", async () => null);
  t.mock.method(configs, "getModelConfigAsync", async () => model);
  t.mock.method(configs, "getDefaultModelConfigAsync", async () => model);
  const balance = t.mock.method(billing, "getSpendableMicros", async () => 10_000_000);
  t.mock.method(rate, "checkRateLimit", async () => ({ allowed: true, remaining: 9, resetAt: new Date(Date.now() + 60000) }));
  t.mock.method(
    context,
    "buildChatPromptContext",
    async (request: Parameters<typeof context.buildChatPromptContext>[0]) => ({
      sanitizedMessages: request.body.messages,
      metadata: { sources: [], kbSearchEnabled: false, kbHitCount: 0 },
      systemPrompt: "trusted personality",
      promptKnowledgeBases: [],
    }),
  );
  t.mock.method(AgentStore.prototype, "workerReady", async () => true);
  t.mock.method(AgentStore.prototype, "currentRun", async () => null);
  t.mock.method(AgentStore.prototype, 'commands', async (run: AgentRunRow, options?: { includeConsumed?: boolean }) => {
    assert.equal(run.user_id, owner);
    assert.equal(options?.includeConsumed, true);
    return [];
  });
  t.mock.method(
    AgentStore.prototype,
    "rpc",
    async (name: string, args: Record<string, unknown>) => {
      writes.push({ name, args });
      return {
        id: args.p_id,
        user_id: owner,
        conversation_id: conversation,
        status: "queued",
        public_message: args.p_message,
        checkpoint: args.p_checkpoint,
        input: args.p_input,
        event_cursor: 1,
        created_at: new Date().toISOString(),
      } as AgentRunRow;
    },
  );
  const body = {
    conversationId: conversation,
    clientRequestId: randomUUID(),
    message: { id: "user", content: "请根据出生资料排盘" },
    model: "fixture",
    webEnabled: false,
  };
  const request = (value: unknown = body) =>
    new NextRequest("http://localhost/api/agent/runs", {
      method: "POST",
      body: JSON.stringify(value),
    });
  return { owner, conversation, writes, body, request, scoped, api, balance, rate, features };
}

test('Agent admission freezes reasoning and independently authorized collaborator settings in the single metered run', async t => {
  const fixture = setup(t);
  const configs = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  t.mock.method(configs, 'getModelConfigAsync', async (id: string) => ({ ...model, id }));
  const collaborators = ['first', 'second'].map(id => ({ id, name: id, model: id, focus: '核对依据', reasoning: true, reasoningEffort: 'max' }));
  const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, reasoning: true, reasoningEffort: 'xhigh', collaborators })));
  assert.equal(response.status, 201);
  assert.equal(fixture.writes.length, 1);
  const input = fixture.writes[0].args.p_input as AgentRunRow['input'];
  assert.equal(input.reasoningEffort, 'xhigh'); assert.deepEqual(input.collaborators, collaborators);
  assert.equal(fixture.writes[0].args.p_billing, 'metered');
});

test('a paid platform model needs a positive balance to start; a free one and BYOK do not', async t => {
  const fixture = setup(t);
  const configs = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  fixture.balance.mock.mockImplementation(async () => 0);
  const refused = await agentEndpoint(() => createAgentTask(fixture.request()));
  assert.equal(refused.status, 402);
  assert.equal((await refused.json()).code, 'INSUFFICIENT_BALANCE');
  assert.equal(fixture.writes.length, 0);

  t.mock.method(configs, 'getModelConfigAsync', async () => ({ ...model, pricing: { input: 0, output: 0, cacheRead: null, cacheWrite: null, image: null } }));
  assert.equal((await agentEndpoint(() => createAgentTask(fixture.request()))).status, 201, 'a free model is metered at $0 without a balance');
  assert.equal(fixture.writes[0].args.p_billing, 'metered');

  t.mock.method(configs, 'getModelConfigAsync', async () => ({ ...model, pricing: undefined }));
  const unpriced = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, clientRequestId: randomUUID() })));
  assert.equal(unpriced.status, 403);
  assert.equal((await unpriced.json()).code, 'MODEL_UNPRICED');
});

test('the task keeps the member\'s approval choice and falls back to auto for anything else', async (t) => {
  const fixture = setup(t);
  const cases: Array<[unknown, string]> = [
    ['manual', 'manual'], ['allow_all', 'allow_all'], ['auto', 'auto'],
    ['sometimes', 'auto'], [undefined, 'auto'], [1, 'auto'],
  ];
  for (const [approval, expected] of cases) {
    const response = await agentEndpoint(() => createAgentTask(fixture.request({
      ...fixture.body, clientRequestId: randomUUID(), approval,
    })));
    assert.equal(response.status, 201, String(approval));
    assert.equal((fixture.writes.at(-1)!.args.p_input as AgentRunRow['input']).approval, expected, String(approval));
  }
});

test('the task keeps the browser\'s time zone for dating the messages sent into it, and ignores one that is not a zone', async t => {
  const fixture = setup(t);
  const zones: Array<string | undefined> = [];
  const context = require('../lib/server/chat/prompt-context') as typeof import('../lib/server/chat/prompt-context');
  t.mock.method(context, 'buildChatPromptContext', async (request: Parameters<typeof context.buildChatPromptContext>[0]) => {
    zones.push(request.body.timezone);
    return { sanitizedMessages: request.body.messages, metadata: { sources: [], kbSearchEnabled: false, kbHitCount: 0 }, systemPrompt: 'trusted personality', promptKnowledgeBases: [] };
  });
  for (const timezone of ['America/New_York', 'Mars/Olympus'])
    assert.equal((await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, clientRequestId: randomUUID(), timezone })))).status, 201);
  assert.deepEqual(fixture.writes.map(write => (write.args.p_input as AgentRunRow['input']).timezone), ['America/New_York', 'Asia/Shanghai']);
  assert.deepEqual(zones, ['America/New_York', 'Asia/Shanghai'], 'the first message is dated in the same zone');
});

test('invalid reasoning/team input and inaccessible collaborator models fail before creation or debit', async t => {
  const fixture = setup(t);
  const member = { id: 'first', name: '分析', model: 'fixture', focus: '', reasoning: false, reasoningEffort: null };
  for (const extra of [{ reasoningEffort: 'unknown' }, { reasoningEffort: 0 }, { collaborators: [member, member] }]) {
    const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, ...extra })));
    assert.equal(response.status, 400);
  }
  const configs = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  t.mock.method(configs, 'getModelConfigAsync', async (id: string) => ({ ...model, id, pricing: id === 'unpriced' ? undefined : model.pricing }));
  const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, collaborators: [member, { ...member, id: 'second', model: 'unpriced' }] })));
  assert.equal(response.status, 403); assert.equal(fixture.writes.length, 0);
});

test("Agent admission honors a denied rate-limit result for platform and BYOK without creating or charging a task", async (t) => {
  const fixture = setup(t);
  t.mock.method(fixture.rate, "checkRateLimit", async (owner: string, endpoint: string) => {
    assert.equal(owner, fixture.owner);
    assert.equal(endpoint, "/api/chat");
    return { allowed: false, remaining: 0, resetAt: new Date(Date.now() + 60000) };
  });
  ownModels(t);
  for (const extra of [{}, { model: OWN_CHAT.ref, byokKeys: { [OWN_CONNECTION]: "sk-user" } }]) {
    const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, ...extra })));
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, "RATE_LIMITED");
  }
  assert.equal(fixture.writes.length, 0);
});

const earlierTurn = [
  { id: 'asked', role: 'user', content: '帮我看看八字', createdAt: '2026-10-20T00:00:00Z' },
  { id: 'answered', role: 'assistant', content: '日主庚金。', createdAt: '2026-10-20T00:01:00Z' },
];

test('/compact creates a metered, tool-less task in its own rate-limit bucket', async t => {
  const fixture = setup(t, earlierTurn);
  const buckets: string[] = [];
  t.mock.method(fixture.rate, 'checkRateLimit', async (_owner: string, endpoint: string) => {
    buckets.push(endpoint);
    return { allowed: true, remaining: 9, resetAt: new Date(Date.now() + 60000) };
  });
  const member = { id: 'first', name: '分析', model: 'fixture', focus: '', reasoning: false, reasoningEffort: null };
  const response = await agentEndpoint(() => createAgentTask(fixture.request({
    ...fixture.body, message: { id: 'compact', content: '/compact  保留八字结论 ' }, webEnabled: true, codeMode: true, planMode: true, collaborators: [member],
  })));
  assert.equal(response.status, 201);
  assert.deepEqual(buckets, ['/api/agent/compact']);
  const write = fixture.writes[0];
  assert.equal(write.args.p_billing, 'metered', 'the summary request pays for its tokens like any other');
  const input = write.args.p_input as AgentRunRow['input'];
  assert.deepEqual(input.compact, { instructions: '保留八字结论' });
  assert.deepEqual([input.webEnabled, input.codeMode, input.planMode, input.collaborators], [false, false, false, []]);
  assert.deepEqual((write.args.p_checkpoint as AgentRunRow['checkpoint']).messages.map(message => message.role), ['user', 'assistant', 'user'], 'it compacts the conversation it continues');
});

test('/compact on a conversation without history fails before creation', async t => {
  const fixture = setup(t);
  const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, message: { id: 'compact', content: '/compact' } })));
  assert.equal(response.status, 400); assert.match((await response.json()).error, /没有可压缩/);
  assert.equal(fixture.writes.length, 0);
});

test('/compact refuses attached material and long instructions, and honors its own rate limit', async t => {
  const fixture = setup(t, earlierTurn);
  for (const extra of [
    { message: { id: 'compact', content: '/compact', attachments: { ids: [randomUUID()] } } },
    { message: { id: 'compact', content: '/compact' }, mentions: [{ type: 'knowledge_base', name: '资料', preview: '' }] },
    { message: { id: 'compact', content: '/compact' }, attachment: { name: '资料.md', text: '附件正文' } },
    { message: { id: 'compact', content: `/compact ${'重点'.repeat(251)}` } },
  ]) assert.equal((await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, ...extra })))).status, 400, JSON.stringify(extra).slice(0, 80));
  t.mock.method(fixture.rate, 'checkRateLimit', async () => ({ allowed: false, remaining: 0, resetAt: new Date(Date.now() + 60000) }));
  const limited = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, message: { id: 'compact', content: '/compact' } })));
  assert.equal(limited.status, 429); assert.match((await limited.json()).error, /压缩上下文过于频繁/);
  assert.equal(fixture.writes.length, 0);
  const ordinary = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, message: { id: 'question', content: '/compactness 是什么' } })));
  assert.equal(ordinary.status, 429);
  assert.match((await ordinary.json()).error, /请求过于频繁/, 'any other message is an ordinary task in the shared bucket');
});

/** A platform skill only the user may start, as the database holds it; returns its block. */
function useSkills(t: TestContext) {
  const store = require('../lib/agent/skills/store.server') as typeof import('../lib/agent/skills/store.server');
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  t.mock.method(store, 'platformSkills', async () => [{
    id: 'skill-1', owner_id: null, name: 'case-review', description: '复盘一个命理案例', version: 2, is_enabled: true,
    disable_model_invocation: true, sort_order: 0, created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z', bytes: 80, files: [],
  }]);
  t.mock.method(store, 'userSkills', async () => []);
  t.mock.method(store, 'readSkillContent', async () => '---\nname: case-review\ndescription: 复盘一个命理案例\ndisable-model-invocation: true\n---\n先读命盘，再列要点。');
  t.mock.method(settings, 'getAgentExtensionsPolicy', async () => DEFAULT_AGENT_EXTENSIONS_POLICY);
  return '<skill name="case-review">\n先读命盘，再列要点。\n</skill>';
}
const contains = (content: unknown, text: string) => JSON.stringify(content).includes(JSON.stringify(text).slice(1, -1));

test('/skill: brings the skill into the task\'s turn while the conversation keeps what the user typed', async t => {
  const fixture = setup(t, [
    ...earlierTurn,
    { id: 'skilled', role: 'user', content: '/skill:case-review 先看这张', createdAt: '2026-10-20T00:02:00Z' },
    { id: 'skilled-answer', role: 'assistant', content: '看过了。', createdAt: '2026-10-20T00:03:00Z' },
  ]);
  const block = useSkills(t);
  const prepared: string[] = [];
  const context = require('../lib/server/chat/prompt-context') as typeof import('../lib/server/chat/prompt-context');
  t.mock.method(context, 'buildChatPromptContext', async (request: Parameters<typeof context.buildChatPromptContext>[0]) => {
    prepared.push(request.body.messages.at(-1)!.content);
    return {
      sanitizedMessages: request.body.messages, metadata: { sources: [], kbSearchEnabled: false, kbHitCount: 0 },
      systemPrompt: 'trusted personality', promptKnowledgeBases: [],
    };
  });
  const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, message: { id: 'user', content: '/skill:case-review 看看这张盘' } })));
  assert.equal(response.status, 201);
  const write = fixture.writes[0];
  assert.equal((write.args.p_input as AgentRunRow['input']).userMessage.content, '/skill:case-review 看看这张盘', 'the conversation shows what the user typed');
  assert.deepEqual(prepared, ['看看这张盘'], 'the prompt is prepared from what the user asked of the skill');
  const messages = (write.args.p_checkpoint as AgentRunRow['checkpoint']).messages;
  assert.equal(messages.length, 5);
  assert.ok(contains(messages[4].content, `${block}\n\n看看这张盘`), JSON.stringify(messages[4].content));
  assert.ok(contains(messages[2].content, `${block}\n\n先看这张`), 'a rebuilt context expands the earlier call again');
});

test('/skill: naming a skill the member cannot use fails before creation, and so does one sent into a task', async t => {
  const fixture = setup(t);
  useSkills(t);
  for (const content of ['/skill:missing 看看', '/skill: 看看']) {
    const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, clientRequestId: randomUUID(), message: { id: 'user', content } })));
    assert.equal(response.status, 400, content);
    assert.equal((await response.json()).code, 'SKILL_UNAVAILABLE');
  }
  assert.equal(fixture.writes.length, 0, 'nothing is created or charged');

  const id = randomUUID();
  const run = {
    id, user_id: fixture.owner, conversation_id: fixture.conversation, input: { model: 'fixture', reasoning: false, webEnabled: false }, checkpoint: {},
    status: 'running', event_cursor: 1, created_at: '2026-01-01', public_message: {
      id: `agent:${id}`, role: 'assistant', content: '', createdAt: '2026-01-01', agent: { version: 1, runId: id, status: 'running', parts: [] },
    },
  } as unknown as AgentRunRow;
  t.mock.method(AgentStore.prototype, 'getRun', async () => run);
  const submitted: string[] = [];
  t.mock.method(AgentStore.prototype, 'rpc', async (_name: string, args: Record<string, unknown>) => {
    submitted.push((args.p_message as { content: string }).content);
    return { message: args.p_message };
  });
  const refused = await agentEndpoint(() => controlAgentTask(fixture.request({ content: '/skill:missing 再看', clientRequestId: randomUUID(), mode: 'steer' }), id, 'message'));
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /没有可用的技能「missing」/);
  const accepted = await agentEndpoint(() => controlAgentTask(fixture.request({ content: '/skill:case-review 再看', clientRequestId: randomUUID(), mode: 'follow_up' }), id, 'message'));
  assert.equal(accepted.status, 200);
  assert.deepEqual(submitted, ['/skill:case-review 再看'], 'the worker expands the message when it delivers it');
});

test('a document carried into Agent mode reaches the model in a new task and in a continued one', async t => {
  const fixture = setup(t, earlierTurn);
  const document = { name: '命书.md', text: '# 命书\n\n甲辰' };
  const context = require('../lib/server/chat/prompt-context') as typeof import('../lib/server/chat/prompt-context');
  t.mock.method(context, 'buildChatPromptContext', async (request: Parameters<typeof context.buildChatPromptContext>[0]) => {
    assert.deepEqual(request.body.attachment, document);
    const messages = request.body.messages;
    return {
      sanitizedMessages: messages.map((message, index) => index === messages.length - 1 ? { ...message, content: `【文件】${document.text}【问题】${message.content}` } : message),
      metadata: { sources: [], kbSearchEnabled: false, kbHitCount: 0 },
      systemPrompt: 'trusted personality',
      promptKnowledgeBases: [],
    };
  });
  const send = () => agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, clientRequestId: randomUUID(), attachment: document })));
  const checkpoint = () => fixture.writes.at(-1)?.args.p_checkpoint as AgentRunRow['checkpoint'];
  const expected = '【文件】# 命书\n\n甲辰【问题】请根据出生资料排盘';
  assert.equal((await send()).status, 201);
  assert.equal(checkpoint().messages.at(-1)?.content, expected);
  // A follow-up to a completed task continues its stored context instead of rebuilding it from the conversation.
  t.mock.method(AgentStore.prototype, 'currentRun', async () => ({
    id: randomUUID(), user_id: fixture.owner, status: 'completed', public_message: { id: 'answered' },
    checkpoint: { version: 2, durable: { engine: AGENT_ENGINE }, messages: [{ role: 'user', content: '帮我看看八字', timestamp: 1 }], parts: [] },
  }) as unknown as AgentRunRow);
  assert.equal((await send()).status, 201);
  assert.deepEqual(checkpoint().messages.map(message => message.content), ['帮我看看八字', expected]);
  const invalid = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, attachment: { name: '命书.md', text: ' ' } })));
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error, '附件内容无效');
});

test('a continued task keeps the tools its context loaded; an edited one starts without them', async t => {
  const fixture = setup(t, earlierTurn);
  t.mock.method(AgentStore.prototype, 'currentRun', async () => ({
    id: randomUUID(), user_id: fixture.owner, status: 'completed', public_message: { id: 'answered' },
    checkpoint: { version: 2, durable: { engine: AGENT_ENGINE }, messages: [{ role: 'user', content: '帮我看看八字', timestamp: 1 }], parts: [], loadedTools: ['bazi_dayun'] },
  }) as unknown as AgentRunRow);
  const send = (extra: Record<string, unknown> = {}) => agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, clientRequestId: randomUUID(), ...extra })));
  const checkpoint = () => fixture.writes.at(-1)?.args.p_checkpoint as AgentRunRow['checkpoint'];
  assert.equal((await send()).status, 201);
  assert.deepEqual(checkpoint().loadedTools, ['bazi_dayun']);
  // Editing rebuilds the context from the visible messages, which hold no tool calls.
  assert.equal((await send({ replaceFromMessageId: 'asked' })).status, 201);
  assert.equal(checkpoint().loadedTools, undefined);
});

test("Agent feature admission fails closed when fresh configuration cannot be read", async (t) => {
  const fixture = setup(t);
  t.mock.method(fixture.features, "readFeatureModuleStateFresh", async () => ({ status: "unavailable" as const }));
  const response = await agentEndpoint(() => createAgentTask(fixture.request()));
  assert.equal(response.status, 403);
  assert.equal(fixture.writes.length, 0);
});

test('network capability follows the search services and connectors set up, and fails closed when it cannot tell', async t => {
  setup(t);
  const session = require('../lib/agent/mcp/session.server') as typeof import('../lib/agent/mcp/session.server');
  const route = require('../lib/agent/mcp/web-route.server') as typeof import('../lib/agent/mcp/web-route.server');
  let servers: unknown = [{ id: 'server' }];
  t.mock.method(session, 'availableMcpServers', async () => {
    if (servers instanceof Error) throw servers;
    return servers as Awaited<ReturnType<typeof session.availableMcpServers>>;
  });
  let searchReady = false;
  t.mock.method(route, 'webRouteAvailable', async () => searchReady);
  const capabilities = async () => {
    const value = (await (await agentCapabilities(new NextRequest('http://localhost/api/agent/capabilities'))).json()) as { webAvailable: boolean; plainWebAvailable: boolean };
    return [value.webAvailable, value.plainWebAvailable];
  };
  assert.deepEqual(await capabilities(), [true, false], 'a connector puts the Agent online; plain chat needs a search service');
  servers = [];
  assert.deepEqual(await capabilities(), [false, false]);
  servers = new Error('database unavailable');
  assert.deepEqual(await capabilities(), [false, false]);
  servers = [];
  searchReady = true;
  assert.deepEqual(await capabilities(), [true, true], 'a search service serves every member');
});

test('administrator code/plan scopes hide the capabilities and force stale task switches off', async t => {
  const fixture = setup(t);
  let states: Record<string, FeatureModuleState> = {
    'agent-tool:code': { status: 'disabled' },
    'agent-tool:plan': { status: 'unavailable' },
  };
  t.mock.method(fixture.features, 'readFeatureModuleStateFresh', async (featureId: string) => states[featureId] ?? { status: 'enabled' as const });
  const capabilities = async () => {
    const value = (await (await agentCapabilities(new NextRequest('http://localhost/api/agent/capabilities'))).json()) as { codeModeAvailable: boolean; planModeAvailable: boolean };
    return [value.codeModeAvailable, value.planModeAvailable];
  };
  assert.deepEqual(await capabilities(), [false, false]);
  // A browser still carrying the old switches must not start a task in either mode.
  const body = { ...fixture.body, codeMode: true, planMode: true };
  assert.equal((await agentEndpoint(() => createAgentTask(fixture.request(body)))).status, 201);
  const refused = fixture.writes.at(-1)!.args.p_input as AgentRunRow['input'];
  assert.equal(refused.codeMode, false);
  assert.equal(refused.planMode, false);

  states = {};
  assert.deepEqual(await capabilities(), [true, true], 'a scope without a row is allowed');
  assert.equal((await agentEndpoint(() => createAgentTask(fixture.request({ ...body, clientRequestId: randomUUID() })))).status, 201);
  const allowed = fixture.writes.at(-1)!.args.p_input as AgentRunRow['input'];
  assert.equal(allowed.codeMode, true);
  assert.equal(allowed.planMode, true);
});

test('image capability is enforced before charging and when adding input to an existing task', async t => {
  const fixture=setup(t), attachmentId=randomUUID(), id=randomUUID();
  const attachments=require('../lib/agent/attachments.server') as typeof import('../lib/agent/attachments.server');
  const configs=require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  t.mock.method(attachments,'validateAttachmentIds',async()=>[{id:attachmentId,user_id:fixture.owner,name:'diagram.png',kind:'image',mime_type:'image/png',status:'ready'}] as Awaited<ReturnType<typeof attachments.validateAttachmentIds>>);
  const body={...fixture.body,message:{...fixture.body.message,attachments:{ids:[attachmentId]}}};
  const denied=await agentEndpoint(()=>createAgentTask(fixture.request(body)));
  assert.equal(denied.status,400); assert.match((await denied.json()).error,/识图/); assert.equal(fixture.writes.length,0);
  t.mock.method(configs,'getModelConfigAsync',async()=>({...model,supportsVision:true}));
  assert.equal((await agentEndpoint(()=>createAgentTask(fixture.request(body)))).status,201);
  const run={id,user_id:fixture.owner,conversation_id:fixture.conversation,input:{model:'fixture'},checkpoint:{},status:'running',event_cursor:1,created_at:'now',public_message:{id:'assistant',role:'assistant',content:'',createdAt:'now',agent:{version:1,runId:id,status:'running',parts:[]}}} as unknown as AgentRunRow;
  t.mock.method(AgentStore.prototype,'getRun',async()=>run);
  t.mock.method(configs,'getModelConfigAsync',async()=>({...model,supportsVision:false}));
  const before=fixture.writes.length;
  const addition=await agentEndpoint(()=>controlAgentTask(fixture.request({content:'补充图片',mode:'steer',clientRequestId:randomUUID(),attachmentIds:[attachmentId]}),id,'message'));
  assert.equal(addition.status,400);assert.match((await addition.json()).error,/不支持图片/);assert.equal(fixture.writes.length,before);
});

test("Agent create uses server history and one metered create RPC; supplied assistant/metadata is discarded", async (t) => {
  const fixture = setup(t);
  const response = await agentEndpoint(() =>
    createAgentTask(
      fixture.request({
        ...fixture.body,
        message: {
          ...fixture.body.message,
          role: "assistant",
          metadata: { secret: "discard" },
          agent: { version: 1 },
        },
      }),
    ),
  );
  assert.equal(response.status, 201);
  assert.equal(fixture.writes.length, 1);
  const write = fixture.writes[0];
  assert.equal(write.name, "agent_create_run");
  assert.equal(write.args.p_billing, "metered");
  const input = write.args.p_input as AgentRunRow["input"];
  assert.equal(input.userMessage.role, "user");
  assert.equal(input.userMessage.metadata, undefined);
  assert.equal(input.systemPrompt, "trusted personality");
  assert.equal(input.timezone, "Asia/Shanghai", "a request without a zone is dated in China Standard Time");
  const view = await response.json();
  assert.equal(view.message.agent.version, 1);
  assert.equal(view.cursor, 1);
  assert.equal(view.input, undefined);
  assert.equal(view.checkpoint, undefined);
});

test("own models with browser keys run exempt, and their keys are sealed to the task and never shown", async (t) => {
  const fixture = setup(t),
    previous = process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY =
    randomBytes(32).toString("base64");
  t.after(() => {
    if (previous === undefined)
      delete process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = previous;
  });
  ownModels(t);
  fixture.balance.mock.mockImplementation(async () => 0);
  const key = "fixture-BYOK-secret";
  const response = await agentEndpoint(() =>
    createAgentTask(fixture.request({
      ...fixture.body, model: OWN_CHAT.ref, imageModel: OWN_IMAGE.ref, byokKeys: { [OWN_CONNECTION]: ` ${key} ` },
    })),
  );
  assert.equal(response.status, 201);
  const write = fixture.writes[0];
  assert.equal(write.args.p_billing, "exempt", "a task of only own models is never charged");
  const credential = write.args.p_credential as { version: number; keys: Record<string, unknown> };
  assert.equal(credential.version, 2);
  assert.deepEqual(Object.keys(credential.keys), [OWN_CONNECTION], "one sealed key per connection, whatever uses it");
  assert.ok(!JSON.stringify(write.args).includes(key));
  assert.ok(!(await response.text()).includes(key));
  const input = write.args.p_input as AgentRunRow["input"];
  assert.equal(input.model, OWN_CHAT.ref);
  assert.equal(input.imageModel, OWN_IMAGE.ref, "generate_image uses the member's own image model");
  assert.equal("byokKeys" in input, false);
  assert.equal((write.args.p_message as { modelName: string }).modelName, "我的 DeepSeek");

  // A platform member makes the task metered again, and a stored key needs nothing from the browser.
  fixture.writes.length = 0;
  const member = { id: "first", name: "分析", model: "fixture", focus: "", reasoning: false, reasoningEffort: null };
  const mixed = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, model: OWN_STORED.ref, collaborators: [member] })));
  assert.equal(mixed.status, 402, "the platform member needs a balance");
  fixture.balance.mock.mockImplementation(async () => 10_000_000);
  const metered = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, clientRequestId: randomUUID(), model: OWN_STORED.ref, collaborators: [member] })));
  assert.equal(metered.status, 201);
  assert.equal(fixture.writes[0].args.p_billing, "metered");
  assert.equal(fixture.writes[0].args.p_credential, null, "a stored key is opened by the worker, not carried by the task");
});

test("own models are refused before mutation when missing, misused, keyless or switched off", async (t) => {
  const fixture = setup(t);
  ownModels(t);
  const keys = { byokKeys: { [OWN_CONNECTION]: "sk-user" } };
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ model: "byok:00000000-0000-4000-8000-0000000000ff", ...keys }, /不存在/],
    [{ model: OWN_IMAGE.ref, ...keys }, /只用于生图/],
    [{ imageModel: OWN_CHAT.ref, ...keys }, /不是生图模型/],
    [{ model: OWN_CHAT.ref }, /需要先在本设备填写 API Key/],
    [{ model: OWN_CHAT.ref, byokKeys: { [OWN_CONNECTION]: "has space" } }, /需要先在本设备填写 API Key/],
    [{ model: OWN_CHAT.ref, byokKeys: { [OWN_CONNECTION]: "k".repeat(513) } }, /Key 无效/],
    [{ model: OWN_CHAT.ref, byokKeys: [] }, /无效/],
    [{ model: OWN_CHAT.ref, byokKeys: { "not-a-connection": "sk-user" } }, /Key 无效/],
    [{ imageModel: 3 }, /生图模型无效/],
    [{ collaborators: [{ id: "first", name: "分析", model: OWN_IMAGE.ref, focus: "", reasoning: false, reasoningEffort: null }], ...keys }, /只用于生图/],
  ];
  for (const [extra, message] of cases) {
    const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, ...extra })));
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.match((await response.json()).error, message);
  }
  t.mock.method(fixture.features, "readFeatureModuleStateFresh", async (id: string) => ({ status: id === "byok" ? "disabled" : "enabled" }) as never);
  const closed = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, model: OWN_STORED.ref })));
  assert.equal(closed.status, 403);
  assert.equal((await closed.json()).code, "BYOK_UNAVAILABLE");
  assert.equal(fixture.writes.length, 0);
});

test("Agent malformed inputs, authentication and cross-user control fail before mutation", async (t) => {
  const fixture = setup(t);
  for (const body of [
    null,
    { ...fixture.body, conversationId: "invalid" },
    {
      ...fixture.body,
      mentions: [
        { type: "bazi_chart", id: "not-uuid", name: "x", preview: "x" },
      ],
    },
    { ...fixture.body, imageModel: "m".repeat(201) },
  ]) {
    const response = await agentEndpoint(() =>
      createAgentTask(fixture.request(body)),
    );
    assert.equal(response.status, 400);
  }
  t.mock.method(AgentStore.prototype, "getRun", async () => null);
  const id = randomUUID();
  assert.equal(
    (await agentEndpoint(() => getAgentTask(fixture.request(), id))).status,
    404,
  );
  assert.equal(
    (
      await agentEndpoint(() =>
        controlAgentTask(fixture.request(), id, "cancel"),
      )
    ).status,
    404,
  );
  assert.equal(
    (await agentEndpoint(() => streamAgentTask(fixture.request(), id))).status,
    404,
  );
  t.mock.method(fixture.api, "requireUserContext", async () => ({
    error: { message: "请登录", status: 401 },
  }));
  assert.equal(
    (await agentEndpoint(() => createAgentTask(fixture.request()))).status,
    401,
  );
  assert.equal(fixture.writes.length, 0);
});

test('public task views include consumed input IDs while execution reads only pending inputs from that task', async () => {
  const rows = [
    { run_id: 'run', consumed: false, sequence: 1, message: { id: 'pending' } },
    { run_id: 'run', consumed: true, sequence: 2, message: { id: 'consumed' } },
    { run_id: 'other', consumed: true, sequence: 3, message: { id: 'foreign' } },
  ];
  const store = new AgentStore(createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        assert.equal(table, 'agent_run_commands');
        const filters: Array<[string, unknown]> = [];
        const query = {
          select() { return query; },
          where(field: string, _operator: string, value: unknown) { filters.push([field, value]); return query; },
          orderBy() { return query; },
          async execute() {
            return rows.filter(row => filters.every(([key, value]) => row[key as keyof typeof row] === value));
          },
        };
        return query;
      },
    } as never),
  }));
  const run = { id: 'run', status: 'completed', input: { model:'fixture',reasoning:false,webEnabled:false }, public_message: { id: 'agent:run', role: 'assistant', content: '', createdAt: '' }, billing: 'exempt' } as AgentRunRow;
  assert.deepEqual((await store.commands(run)).map(command => command.message.id), ['pending']);
  const view = await store.view(run);
  assert.deepEqual(view.commandMessageIds, ['pending', 'consumed']);
  assert.equal(view.billing, 'exempt', 'the workspace reports whether the task is metered');
});

test('Agent commands persist a server-owned task association and discard supplied metadata', async (t) => {
  const fixture = setup(t), id = randomUUID();
  const run = {
    id, user_id: fixture.owner, conversation_id: fixture.conversation, input: { model:'fixture',reasoning:false,webEnabled:false }, checkpoint: {}, status: 'awaiting_input', event_cursor: 1,
    created_at: '2026-01-01', public_message: {
      id: `agent:${id}`, role: 'assistant', content: '', createdAt: '2026-01-01',
      agent: { version: 1, runId: id, status: 'awaiting_input', parts: [] },
    },
  } as unknown as AgentRunRow;
  t.mock.method(AgentStore.prototype, 'getRun', async (_id: string, owner: string) => {
    assert.equal(_id, id);
    assert.equal(owner, fixture.owner);
    return run;
  });
  t.mock.method(AgentStore.prototype, 'rpc', async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, 'agent_submit_command');
    const message = args.p_message as { metadata: unknown };
    assert.deepEqual(JSON.parse(JSON.stringify(message.metadata)), { agentRunId: id, agentCommandMode: args.p_mode });
    return { message };
  });
  for (const mode of ['reply', 'steer', 'follow_up']) {
    const response = await agentEndpoint(() => controlAgentTask(fixture.request({ content: '补充回答', clientRequestId: randomUUID(), mode, metadata: { agentRunId: 'forged' } }), id, 'message'));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).message.metadata, { agentRunId: id, agentCommandMode: mode });
  }
});

test("Agent SSE replays stored event IDs then one atomic public snapshot with a resumable cursor", async (t) => {
  const fixture = setup(t),
    id = randomUUID();
  const run = {
    id,
    user_id: fixture.owner,
    conversation_id: fixture.conversation,
    status: "completed",
    event_cursor: 3,
    created_at: "2026-01-01",
    public_message: {
      id: `agent:${id}`,
      role: "assistant",
      content: "最终结果",
      createdAt: "2026-01-01",
      agent: { version: 1, runId: id, status: "completed", parts: [] },
    },
  } as unknown as AgentRunRow;
  t.mock.method(AgentStore.prototype, "getRun", async () => run);
  t.mock.method(
    AgentStore.prototype,
    "events",
    async (_id: string, after: number, through: number) => {
      assert.equal(after, 1);
      assert.equal(through, 3);
      return [
        { sequence: 2, type: "tool_execution_end", payload: { version: 1 } },
        { sequence: 3, type: "completed", payload: {} },
      ];
    },
  );
  const response = await agentEndpoint(() =>
    streamAgentTask(
      new NextRequest(`http://localhost/api/agent/runs/${id}/events?after=1`),
      id,
    ),
  );
  const text = await response.text();
  assert.match(text, /event: history\nid: 2/);
  assert.match(text, /event: history\nid: 3/);
  assert.match(text, /event: snapshot\nid: 3/);
  assert.match(text, /最终结果/);
  assert.ok(!text.includes("checkpoint"));
  assert.ok(!text.includes("ciphertext"));
});

test("Agent request hashes are independent of object property order but distinguish edits and keys", () => {
  assert.equal(
    hashAgentRequest({ b: 2, a: { y: 2, x: 1 } }),
    hashAgentRequest({ a: { x: 1, y: 2 }, b: 2 }),
  );
  assert.notEqual(
    hashAgentRequest({ content: "a" }),
    hashAgentRequest({ content: "b" }),
  );
});

test('SSE accepts gaps from the global event sequence and resynchronizes a changed worker epoch', async t => {
  const f=setup(t), id=randomUUID();
  const run={id,user_id:f.owner,conversation_id:f.conversation,status:'completed',fence:2,event_cursor:100,created_at:'now',public_message:{id:'assistant',role:'assistant',content:'完成',createdAt:'now',agent:{version:1,runId:id,status:'completed',parts:[]}}} as unknown as AgentRunRow;
  t.mock.method(AgentStore.prototype,'getRun',async()=>run);
  t.mock.method(AgentStore.prototype,'events',async()=>[{sequence:30,type:'tool',payload:{}},{sequence:100,type:'completed',payload:{}}]);
  const current=await (await streamAgentTask(new NextRequest(`http://localhost/api/agent/runs/${id}/events?after=10&epoch=2`),id)).text();
  assert.match(current,/id: 30/);assert.doesNotMatch(current,/event: resync/);
  const stale=await (await streamAgentTask(new NextRequest(`http://localhost/api/agent/runs/${id}/events?after=10&epoch=1`),id)).text();
  assert.match(stale,/event: resync/);assert.match(stale,/"reason":"epoch"/);assert.match(stale,/event: snapshot\nid: 100/);
});

test("Agent SSE stays open while awaiting input and observes another tab's resume and completion", async (t) => {
  const fixture = setup(t), id = randomUUID();
  let status = "awaiting_input", cursor = 1;
  const run = () => ({
    id, user_id: fixture.owner, conversation_id: fixture.conversation, status, event_cursor: cursor,
    created_at: "2026-01-01", public_message: {
      id: `agent:${id}`, role: "assistant", content: "", createdAt: "2026-01-01",
      agent: { version: 1, runId: id, status, parts: [] },
    },
  }) as unknown as AgentRunRow;
  t.mock.method(AgentStore.prototype, "getRun", async () => run());
  t.mock.method(AgentStore.prototype, "runState", async () => ({
    id, status, event_cursor: cursor, fence: 0, cancel_requested: false, lease_until: null, updated_at: null,
  }));
  t.mock.method(AgentStore.prototype, "events", async () => []);
  const controller = new AbortController();
  const response = await streamAgentTask(new NextRequest(`http://localhost/api/agent/runs/${id}/events`, { signal: controller.signal }), id);
  const reader = response.body!.getReader();
  t.after(() => { controller.abort(); void reader.cancel(); });
  const decoder = new TextDecoder();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.match(decoder.decode(first.value), /awaiting_input/);
  status = "running"; cursor++;
  const resumed = await reader.read();
  assert.equal(resumed.done, false);
  assert.match(decoder.decode(resumed.value), /running/);
  status = "completed"; cursor++;
  const completed = await reader.read();
  assert.match(decoder.decode(completed.value), /completed/);
  assert.equal((await reader.read()).done, true);
});

test("idle SSE heartbeats read only the run row; the public view is built when a frame is due", async (t) => {
  const fixture = setup(t), id = randomUUID();
  const run = {
    id, user_id: fixture.owner, conversation_id: fixture.conversation, status: "running", fence: 1, event_cursor: 1,
    created_at: "2026-01-01", public_message: {
      id: `agent:${id}`, role: "assistant", content: "", createdAt: "2026-01-01",
      agent: { version: 1, runId: id, status: "running", parts: [] },
    },
  } as unknown as AgentRunRow;
  t.mock.method(AgentStore.prototype, "getRun", async () => run);
  t.mock.method(AgentStore.prototype, "runState", async () => ({
    id, status: run.status, event_cursor: run.event_cursor, fence: run.fence,
    cancel_requested: false, lease_until: null, updated_at: null,
  }));
  t.mock.method(AgentStore.prototype, "events", async () => [{ sequence: 2, type: "tool_execution_end", payload: {} }]);
  const view = t.mock.method(AgentStore.prototype, "view", async (row: AgentRunRow) => ({
    id: row.id, conversationId: row.conversation_id, status: row.status, message: row.public_message,
    cursor: Number(row.event_cursor), createdAt: row.created_at,
  }));
  const controller = new AbortController();
  const response = await streamAgentTask(new NextRequest(`http://localhost/api/agent/runs/${id}/events?after=1&epoch=1`, { signal: controller.signal }), id);
  const reader = response.body!.getReader();
  t.after(() => { controller.abort(); void reader.cancel(); });
  const decoder = new TextDecoder();
  assert.equal(decoder.decode((await reader.read()).value), ": heartbeat\n\n");
  assert.equal(view.mock.callCount(), 0, "an unchanged cursor never reads the command queue");
  run.event_cursor = 2;
  let frames = "";
  while (!frames.includes("event: snapshot")) frames += decoder.decode((await reader.read()).value);
  assert.match(frames, /event: history\nid: 2/);
  assert.match(frames, /event: snapshot\nid: 2/);
  assert.equal(view.mock.callCount(), 1);
});
