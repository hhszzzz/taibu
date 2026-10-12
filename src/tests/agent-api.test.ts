import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { TestContext } from "node:test";
import {
  createMockAuthContext,
  createMockSupabaseClient,
} from "./helpers/supabase-mock";
import { AgentStore, type AgentRunRow } from "../lib/agent/store.server";
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

const model: AIModelConfig = {
  id: "fixture",
  name: "fixture",
  vendor: "other",
  modelId: "fixture",
  apiUrl: "https://model.example/v1",
  apiKeyEnvVar: "FIXTURE",
  supportsReasoning: true,
  requiredTier: "free",
};
function setup(t: TestContext) {
  const owner = randomUUID(),
    conversation = randomUUID(),
    writes: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = createMockSupabaseClient({
    tables: {
      agent_run_commands: { data: null },
      conversations: {
        data: { id: conversation, messages: [], title: "fixture" },
      },
    },
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
  const credits =
    require("../lib/user/credits") as typeof import("../lib/user/credits");
  const rate =
    require("../lib/rate-limit") as typeof import("../lib/rate-limit");
  t.mock.method(api, "requireUserContext", async () =>
    createMockAuthContext(client, owner),
  );
  t.mock.method(
    api,
    "getSystemAdminClient",
    () => client as unknown as ReturnType<typeof api.getSystemAdminClient>,
  );
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
  t.mock.method(credits, "getUserAuthInfo", async () => ({
    credits: 10,
    hasCredits: true,
    effectiveMembership: "plus",
  }));
  t.mock.method(rate, "checkRateLimit", async () => ({ allowed: true, remaining: 9, resetAt: new Date(Date.now() + 60000) }));
  t.mock.method(
    context,
    "buildChatPromptContext",
    async (request: Parameters<typeof context.buildChatPromptContext>[0]) => ({
      sanitizedMessages: request.body.messages,
      metadata: { sources: [], kbSearchEnabled: false, kbHitCount: 0 },
      systemPrompt: "trusted personality",
      fallbackPersonality: "general",
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
  return { owner, conversation, writes, body, request, client, api, credits, rate, features };
}

test('Agent admission freezes reasoning and independently authorized collaborator settings in the single charged run', async t => {
  const fixture = setup(t);
  const configs = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  t.mock.method(configs, 'getModelConfigAsync', async (id: string) => ({ ...model, id }));
  const collaborators = ['first', 'second'].map(id => ({ id, name: id, model: id, focus: '核对依据', reasoning: true, reasoningEffort: 'max' }));
  const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, reasoning: true, reasoningEffort: 'xhigh', collaborators })));
  assert.equal(response.status, 201);
  assert.equal(fixture.writes.length, 1);
  const input = fixture.writes[0].args.p_input as AgentRunRow['input'];
  assert.equal(input.reasoningEffort, 'xhigh'); assert.deepEqual(input.collaborators, collaborators);
  assert.equal(fixture.writes[0].args.p_charge, true);
});

test('invalid reasoning/team input and inaccessible collaborator models fail before creation or debit', async t => {
  const fixture = setup(t);
  const member = { id: 'first', name: '分析', model: 'fixture', focus: '', reasoning: false, reasoningEffort: null };
  for (const extra of [{ reasoningEffort: 'unknown' }, { reasoningEffort: 0 }, { collaborators: [member] }, { collaborators: [member, member] }]) {
    const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, ...extra })));
    assert.equal(response.status, 400);
  }
  const configs = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  t.mock.method(configs, 'getModelConfigAsync', async (id: string) => ({ ...model, id, requiredTier: id === 'restricted' ? 'pro' : 'free' }));
  const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, collaborators: [member, { ...member, id: 'second', model: 'restricted' }] })));
  assert.equal(response.status, 403); assert.equal(fixture.writes.length, 0);
});

test("Agent admission honors a denied rate-limit result for platform and BYOK without creating or charging a task", async (t) => {
  const fixture = setup(t);
  t.mock.method(fixture.rate, "checkRateLimit", async (owner: string, endpoint: string) => {
    assert.equal(owner, fixture.owner);
    assert.equal(endpoint, "/api/chat");
    return { allowed: false, remaining: 0, resetAt: new Date(Date.now() + 60000) };
  });
  for (const extra of [{}, { customProvider: { apiUrl: "https://model.example/v1", apiKey: "fixture", modelId: "fixture" } }]) {
    const response = await agentEndpoint(() => createAgentTask(fixture.request({ ...fixture.body, ...extra })));
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, "RATE_LIMITED");
  }
  assert.equal(fixture.writes.length, 0);
});

test("Agent feature admission fails closed when fresh configuration cannot be read", async (t) => {
  const fixture = setup(t);
  t.mock.method(fixture.features, "readFeatureModuleStateFresh", async () => ({ status: "unavailable" as const }));
  const response = await agentEndpoint(() => createAgentTask(fixture.request()));
  assert.equal(response.status, 403);
  assert.equal(fixture.writes.length, 0);
});

test('network capability includes a configured MCP service and ignores malformed configuration', async t => {
  setup(t);
  const previous = { mcp: process.env.AGENT_MCP_SERVERS, tavily: process.env.TAVILY_API_KEY };
  t.after(() => {
    for (const [key, value] of [['AGENT_MCP_SERVERS', previous.mcp], ['TAVILY_API_KEY', previous.tavily]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  delete process.env.TAVILY_API_KEY;
  const available = async () => (await (await agentCapabilities(new NextRequest('http://localhost/api/agent/capabilities'))).json()).webAvailable;
  process.env.AGENT_MCP_SERVERS = JSON.stringify([{ name: 'reference', url: 'https://mcp.example/tools', tools: ['lookup'] }]);
  assert.equal(await available(), true);
  process.env.AGENT_MCP_SERVERS = 'invalid-json';
  assert.equal(await available(), false);
  process.env.TAVILY_API_KEY = 'fixture';
  assert.equal(await available(), true);
});

test('image capability is enforced before charging and when adding input to an existing task', async t => {
  const fixture=setup(t), attachmentId=randomUUID(), id=randomUUID();
  const attachments=require('../lib/agent/attachments.server') as typeof import('../lib/agent/attachments.server');
  const configs=require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  t.mock.method(attachments,'validateAttachmentIds',async()=>[{id:attachmentId,user_id:fixture.owner,name:'diagram.png',kind:'image',mime_type:'image/png',status:'ready'}] as Awaited<ReturnType<typeof attachments.validateAttachmentIds>>);
  const body={...fixture.body,message:{...fixture.body.message,attachments:{ids:[attachmentId]}}};
  const denied=await agentEndpoint(()=>createAgentTask(fixture.request(body)));
  assert.equal(denied.status,400); assert.match((await denied.json()).error,/视觉模型/); assert.equal(fixture.writes.length,0);
  t.mock.method(configs,'getModelConfigAsync',async()=>({...model,supportsVision:true}));
  assert.equal((await agentEndpoint(()=>createAgentTask(fixture.request(body)))).status,201);
  const run={id,user_id:fixture.owner,conversation_id:fixture.conversation,input:{model:'fixture'},checkpoint:{},status:'running',event_cursor:1,created_at:'now',public_message:{id:'assistant',role:'assistant',content:'',createdAt:'now',agent:{version:1,runId:id,status:'running',parts:[]}}} as unknown as AgentRunRow;
  t.mock.method(AgentStore.prototype,'getRun',async()=>run);
  t.mock.method(configs,'getModelConfigAsync',async()=>({...model,supportsVision:false}));
  const before=fixture.writes.length;
  const addition=await agentEndpoint(()=>controlAgentTask(fixture.request({content:'补充图片',mode:'steer',clientRequestId:randomUUID(),attachmentIds:[attachmentId]}),id,'message'));
  assert.equal(addition.status,400);assert.match((await addition.json()).error,/不支持图片/);assert.equal(fixture.writes.length,before);
});

test("Agent create uses server history and an atomic charge RPC; supplied assistant/metadata is discarded", async (t) => {
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
  assert.equal(write.args.p_charge, true);
  const input = write.args.p_input as AgentRunRow["input"];
  assert.equal(input.userMessage.role, "user");
  assert.equal(input.userMessage.metadata, undefined);
  assert.equal(input.systemPrompt, "trusted personality");
  const view = await response.json();
  assert.equal(view.message.agent.version, 1);
  assert.equal(view.cursor, 1);
  assert.equal(view.input, undefined);
  assert.equal(view.checkpoint, undefined);
});

test("Agent BYOK is encrypted, exempt and omitted from every public result and execution checkpoint", async (t) => {
  const fixture = setup(t),
    previous = process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY =
    randomBytes(32).toString("base64");
  t.after(() => {
    if (previous === undefined)
      delete process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = previous;
  });
  t.mock.method(fixture.credits, "getUserAuthInfo", async () => ({
    credits: 0,
    hasCredits: false,
    effectiveMembership: "free",
  }));
  const key = "fixture-BYOK-secret";
  const response = await agentEndpoint(() =>
    createAgentTask(
      fixture.request({
        ...fixture.body,
        customProvider: {
          apiUrl: "https://model.example/v1",
          apiKey: key,
          modelId: "fixture",
        },
      }),
    ),
  );
  assert.equal(response.status, 201);
  const write = fixture.writes[0];
  assert.equal(write.args.p_charge, false);
  assert.ok(write.args.p_credential);
  assert.ok(!JSON.stringify(write.args).includes(key));
  assert.ok(!(await response.text()).includes(key));
  assert.equal(
    (write.args.p_input as AgentRunRow["input"]).customProvider?.apiUrl,
    "https://model.example/v1",
  );
});

test("Agent malformed inputs, private custom URLs, authentication and cross-user control fail before mutation", async (t) => {
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
    {
      ...fixture.body,
      customProvider: {
        apiUrl: "https://127.0.0.1/v1",
        apiKey: "key",
        modelId: "x",
      },
    },
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
  const store = new AgentStore({
    from: (table: string) => {
      assert.equal(table, 'agent_run_commands');
      const filters: Array<[string, unknown]> = [];
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
        order: (field: string) => { assert.ok(['sort_order','sequence'].includes(field)); return query; },
        then: (resolve: (value: unknown) => void) => resolve({ data: rows.filter(row => filters.every(([key, value]) => row[key as keyof typeof row] === value)), error: null }),
      };
      return query;
    },
  } as unknown as ConstructorParameters<typeof AgentStore>[0]);
  const run = { id: 'run', status: 'completed', input: { model:'fixture',reasoning:false,webEnabled:false }, public_message: { id: 'agent:run', role: 'assistant', content: '', createdAt: '' }, billing: 'refunded' } as AgentRunRow;
  assert.deepEqual((await store.commands(run)).map(command => command.message.id), ['pending']);
  const view = await store.view(run);
  assert.deepEqual(view.commandMessageIds, ['pending', 'consumed']);
  assert.equal(view.billing, 'refunded', 'the workspace reports the settled credit state, not the initial charge');
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
