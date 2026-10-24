import { test, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createAssistantMessageEventStream, getCurrentTools,
} from "@earendil-works/pi-ai";
import type { PiStreamFn as StreamFn } from "../lib/agent/types";
import type { StorageWrite } from "@earendil-works/pi-durable";
import {
  AgentStore,
  type AgentRunRow,
  type AgentArtifactRow,
  type AgentCommandRow,
} from "../lib/agent/store.server";
import {
  AGENT_COMPACTION_FAILED_MESSAGE,
  AGENT_RESTART_LIMIT_MESSAGE,
  agentReportFields,
  executeAgentRun,
} from "../lib/agent/runtime.server";
import { AGENT_TRANSIENT_ERROR_MESSAGE, emptyPiAssistant } from "../lib/agent/pi-stream.server";
import {
  stableAgentSeed,
  createAgentTools,
} from "../lib/agent/tools.server";
import { MockLanguageModelV3 } from "ai/test";
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate';

import { config, row, MemoryStore, scripted, isSummaryTranscript } from "./helpers/agent-runtime-fixture";
import { __dispatchAgentSignalForTests as dispatchAgentSignal } from "../lib/db/listen.server";
beforeEach((t) => {
  assert.ok("mock" in t);
  const credits =
    require("../lib/user/credits") as typeof import("../lib/user/credits");
  const settings =
    require("../lib/app-settings") as typeof import("../lib/app-settings");
  const sdk =
    require("../lib/ai/providers/ai-sdk-provider") as typeof import("../lib/ai/providers/ai-sdk-provider");
  t.mock.method(credits, "getUserCreditInfo", async () => ({
    membership: "plus",
    credits: 10,
    expiresAt: null,
  }));
  t.mock.method(settings, "readFeatureModuleStateFresh", async () => ({ status: "enabled" as const }));
  t.mock.method(sdk, "isModelAvailable", () => true);
  t.mock.method(sdk, "createModelFromConfig", () => new MockLanguageModelV3());
});

test("Pi completes more than common loop defaults using real core tools with no per-task cap", async () => {
  const store = new MemoryStore(),
    run = row();
  let rounds = 0;
  const streamFn = scripted((index) => {
    rounds++;
    if (index < 35)
      return [
        {
          type: "toolCall",
          id: `calculation-${index}`,
          name: "bazi",
          arguments: {
            gender: "male",
            birthYear: 1990,
            birthMonth: 1,
            birthDay: 15,
            birthHour: 9,
          },
        },
      ];
    return [{ type: "text", text: "最终八字分析" }];
  });
  await executeAgentRun(store, run, undefined, { config: { ...config, id: "deepseek-v3.2" }, streamFn });
  const finish = store.writes.find((w) => w.name === "agent_finish_run")!;
  assert.equal(
    finish.args.p_status,
    "completed",
    (finish.args.p_message as AgentRunRow["public_message"]).agent?.error,
  );
  assert.equal(rounds, 36);
  assert.equal(store.calculations().length, 35);
  const cp = finish.args.p_checkpoint as AgentRunRow["checkpoint"];
  assert.equal(cp.version, 2);
  assert.equal(store.nativeEntries().flatMap(e => e.model ?? []).filter(m => m.role === "toolResult").length, 35);
  assert.ok(JSON.stringify(store.log).includes("日主"));
  assert.ok(
    store.nativeEntries().some(e => e.kind === "pi.compaction"),
  );
  assert.ok(
    store.writes.every((w) => w.name !== "agent_create_run"),
    "runtime never recharges",
  );
});

test("ask_user pauses and a reply is consumed in the same checkpoint before continuation", async () => {
  const store = new MemoryStore(),
    run = row();
  await executeAgentRun(store, run, undefined, {
    config,
    streamFn: scripted(() => [
      {
        type: "toolCall",
        id: "question",
        name: "ask_user",
        arguments: { question: "出生年月日和时辰？" },
      },
    ]),
  });
  const first = store.writes.find((w) => w.name === "agent_finish_run")!;
  assert.equal(
    first.args.p_status,
    "awaiting_input",
    JSON.stringify(first.args.p_message),
  );
  run.checkpoint = first.args.p_checkpoint as AgentRunRow["checkpoint"];
  store.pending = [
    {
      sequence: 7,
      mode: "reply",
      message: {
        id: "reply",
        role: "user",
        content: "1990年1月15日9点",
        createdAt: new Date().toISOString(),
      },
    },
  ];
  let sawReply = false;
  await executeAgentRun(store, run, undefined, {
    config,
    streamFn: scripted(
      () => [{ type: "text", text: "根据补充信息完成分析" }],
      (messages) => {
        sawReply = messages.some(
          (m) =>
            m.role === "user" &&
            typeof m.content === "string" &&
            m.content.includes("1990年"),
        );
      },
    ),
  });
  assert.equal(sawReply, true);
  assert.equal(store.pending.length, 0);
  assert.equal(
    store.writes.filter((w) => w.name === "agent_finish_run").at(-1)!.args
      .p_status,
    "completed",
  );
  assert.ok(
    store.writes.some(
      (w) => w.name === "agent_durable_commit" &&
        (w.args.p_writes as StorageWrite[]).some(s => s.type === "submission" && s.value.requestId === "command:7" && s.value.status === "placed"),
    ),
  );
});

test("a committed native tool result with a lost receipt is recovered without recaching or recharging", async () => {
  class LostReceiptStore extends MemoryStore {
    lossRemaining = 2;
    failedSequence = 0;
    override async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const result = await super.rpc<T>(name, args);
      if (name === "agent_durable_commit") {
        const writes = args.p_writes as StorageWrite[];
        if (!this.failedSequence && writes.some(w => w.type === "entry" && w.value.model?.some(m => m.role === "toolResult" && m.toolName === "bazi")))
          this.failedSequence = Number(args.p_sequence);
        if (Number(args.p_sequence) === this.failedSequence && this.lossRemaining-- > 0)
          throw new Error("native receipt lost");
      }
      return result;
    }
  }
  const store = new LostReceiptStore(), run = row();
  run.checkpoint.version = 2;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => [{
    type: "toolCall", id: "cached-before-loss", name: "bazi",
    arguments: { gender: "male", birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 },
  }]) });
  assert.equal(store.drafts.size, 1);
  assert.ok(!store.writes.some(w => w.name === "agent_finish_run"), "ambiguous storage must retain credentials and charge for takeover");
  run.checkpoint = store.writes.filter(w => w.name === "agent_durable_commit").at(-1)!.args.p_checkpoint as AgentRunRow["checkpoint"];
  run.fence++;
  await executeAgentRun(store, run, undefined, {
    config, streamFn: scripted(() => [{ type: "text", text: "工具结果接管后完成" }]),
  });
  const finish = store.writes.find(w => w.name === "agent_finish_run")!;
  assert.equal(finish.args.p_status, "completed");
  assert.equal(store.writes.filter(w => w.name === "agent_cache_tool" && w.args.p_tool_name === "bazi").length, 1);
  assert.equal(store.writes.filter(w => w.name === "agent_create_run").length, 0);
});

test("two pending questions use separate human replies without consuming a queued reply twice", async () => {
  const store = new MemoryStore(), run = row();
  const input = (sequence: number, content: string): AgentCommandRow => ({
    sequence, mode: "reply", message: { id: String(sequence), role: "user", content, createdAt: new Date().toISOString() },
  });
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => [
    { type: "toolCall", id: "date", name: "ask_user", arguments: { question: "出生日期？" } },
    { type: "toolCall", id: "gender", name: "ask_user", arguments: { question: "性别？" } },
  ]) });
  let finished = store.writes.filter(w => w.name === "agent_finish_run").at(-1)!;
  assert.equal(finished.args.p_status, "awaiting_input");
  run.checkpoint = finished.args.p_checkpoint as AgentRunRow["checkpoint"];
  store.pending.push(input(7, "1990年1月15日9时"));
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => { throw new Error("second question remains pending"); }) });
  finished = store.writes.filter(w => w.name === "agent_finish_run").at(-1)!;
  assert.equal(finished.args.p_status, "awaiting_input");
  assert.equal((finished.args.p_checkpoint as AgentRunRow["checkpoint"]).question, "性别？");
  assert.equal(store.pending.length, 1, "admitted first reply stays queued until the round boundary");
  run.checkpoint = finished.args.p_checkpoint as AgentRunRow["checkpoint"];
  store.pending.push(input(8, "男性"));
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => [{ type: "text", text: "两项补充已确认" }], messages => {
    const replies = messages.filter((m): m is import("@earendil-works/pi-ai").ToolResultMessage => m.role === "toolResult" && m.toolName === "ask_user");
    assert.ok(replies.some(m => JSON.stringify(m.content).includes("1990年")));
    assert.ok(replies.some(m => JSON.stringify(m.content).includes("男性")));
  }) });
  finished = store.writes.filter(w => w.name === "agent_finish_run").at(-1)!;
  assert.equal(finished.args.p_status, "completed");
  assert.equal(store.pending.length, 0);
});

test("repeated model call IDs identify distinct native ToolTasks", async () => {
  const store = new MemoryStore(), run = row();
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => {
    if (index < 2) return [{
      type: "toolCall", id: "same-model-id", name: "bazi",
      arguments: { gender: "male", birthYear: 1990, birthMonth: 1, birthDay: 15 + index, birthHour: 9 },
    }];
    if (index === 2) return [{ type: "toolCall", id: "same-model-id", name: "todo_write", arguments: { revision: 0, items: [{ id: "compare", title: "比较两个命盘", status: "completed" }] } }];
    return [{ type: "text", text: "两个不同命盘" }];
  }) });
  assert.equal(store.writes.find(w => w.name === "agent_finish_run")!.args.p_status, "completed");
  assert.equal(store.calculations().length, 2);
  assert.equal(new Set([...store.drafts.values()].map(d => d.call_id)).size, 3);
});

test("lease renewal begins while a long native log is still reopening", async () => {
  class SlowReadStore extends MemoryStore {
    renewingBeforeOpen = false;
    reading = false;
    override async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      if (name === "agent_durable_read") {
        this.reading = true;
        await new Promise(resolve => setTimeout(resolve, 1200));
        this.reading = false;
      }
      if (name === "agent_renew_lease" && this.reading) this.renewingBeforeOpen = true;
      return super.rpc<T>(name, args);
    }
  }
  const store = new SlowReadStore();
  await executeAgentRun(store, row(), undefined, { config, leaseRenewMs: 200, streamFn: scripted(() => [{ type: "text", text: "加载后完成" }]) });
  assert.equal(store.renewingBeforeOpen, true);
  assert.equal(store.writes.find(w => w.name === "agent_finish_run")!.args.p_status, "completed");
});

test("Agent database RPC requests carry a per-request deadline", async () => {
  let timeoutMs: number | undefined;
  const store = new AgentStore({
    scope: { kind: 'system' },
    tx: async () => { throw new Error('not used'); },
    rpc: async (_name: string, _args: Record<string, unknown>, options?: { timeoutMs?: number }) => { timeoutMs = options?.timeoutMs; return 7; },
  } as never);
  assert.equal(await store.rpc("fixture", {}), 7);
  assert.equal(timeoutMs, 30_000);
});

test("an empty new answer cannot succeed by reusing an earlier task's history", async () => {
  const store = new MemoryStore(), run = row();
  const history = emptyPiAssistant({ id: "fixture", provider: "taibu" } as Parameters<typeof emptyPiAssistant>[0]);
  history.content = [{ type: "text", text: "之前任务的回答" }];
  history.stopReason = "stop";
  run.checkpoint.messages.unshift(history);
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => []) });
  const finished = store.writes.find(w => w.name === "agent_finish_run")!;
  assert.equal(finished.args.p_status, "failed");
  assert.equal((finished.args.p_message as AgentRunRow["public_message"]).content, "");
});

test("unsupported tools are reported without copying upstream error details", async () => {
  const store = new MemoryStore(), run = row();
  await executeAgentRun(store, run, undefined, { config, streamFn: model => {
    const stream = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
    message.stopReason = "error";
    message.errorMessage = "当前模型不支持工具调用，请切换普通对话";
    stream.push({ type: "error", reason: "error", error: message });
    stream.end(message);
    return stream;
  } });
  const finished = store.writes.find(w => w.name === "agent_finish_run")!;
  assert.equal(finished.args.p_status, "failed");
  assert.match((finished.args.p_message as AgentRunRow["public_message"]).agent!.error!, /不支持工具调用/);
});

test("native Durable settlement fails SDK EOF and timeout, retaining visible text without saving a record", async (t) => {
  const sdk = require("../lib/ai/providers/ai-sdk-provider") as typeof import("../lib/ai/providers/ai-sdk-provider");
  for (const scenario of ["eof", "timeout"] as const) {
    const timeout = new AbortController();
    t.mock.method(AbortSignal, "timeout", () => timeout.signal);
    const model = new MockLanguageModelV3({ doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text" });
        controller.enqueue({ type: "text-delta", id: "text", delta: "partial interrupted response" });
        if (scenario === "eof") controller.close();
        else {
          abortSignal!.addEventListener("abort", () => controller.error(abortSignal!.reason), { once: true });
          setTimeout(() => timeout.abort(), 20);
        }
      } }),
    }) });
    t.mock.method(sdk, "createModelFromConfig", () => model);
    const store = new MemoryStore();
    await executeAgentRun(store, row(), undefined, { config });
    const finished = store.writes.find(w => w.name === "agent_finish_run")!;
    assert.equal(finished.args.p_status, "failed", scenario);
    assert.match((finished.args.p_message as AgentRunRow["public_message"]).content, /partial interrupted/);
    assert.ok(store.log.flatMap(c => c.writes).some(w => w.type === "submission" && w.value.status === "unanswered"));
    assert.equal(model.doStreamCalls.length, 1);
  }
});

test("fresh unavailable or disabled Agent permission blocks every model turn even with a permissive cache", async (t) => {
  const features = require("../lib/app-settings") as typeof import("../lib/app-settings");
  t.mock.method(features, "isFeatureModuleEnabled", async () => true);
  for (const state of ["disabled", "unavailable"] as const) {
    t.mock.method(features, "readFeatureModuleStateFresh", async (feature: Parameters<typeof features.readFeatureModuleStateFresh>[0]) => ({ status: feature === "agent" ? state : "enabled" }));
    let calls = 0;
    const store = new MemoryStore();
    await executeAgentRun(store, row(), undefined, { config, streamFn: scripted(() => { calls++; return [{ type: "text", text: "must not run" }]; }) });
    assert.equal(calls, 0);
    const finish = store.writes.find(w => w.name === "agent_finish_run")!;
    assert.equal(finish.args.p_status, "failed");
  }
});

test("Agent completion depends on chat permissions, independently of records availability", async (t) => {
  const features = require("../lib/app-settings") as typeof import("../lib/app-settings");
  t.mock.method(console, "warn", () => {});
  t.mock.method(features, "isFeatureModuleEnabled", async () => true);
  for (const state of ["disabled", "unavailable"] as const) {
    t.mock.method(features, "readFeatureModuleStateFresh", async (feature: Parameters<typeof features.readFeatureModuleStateFresh>[0]) => ({ status: feature === "records" ? state : "enabled" }));
    const store = new MemoryStore();
    await executeAgentRun(store, row(), undefined, { config, streamFn: scripted(() => [{ type: "text", text: "visible final text" }]) });
    const finish = store.writes.filter(w => w.name === "agent_finish_run");
    assert.equal(finish.length, 1);
    assert.equal(finish[0].args.p_status, "completed");
    assert.equal((finish[0].args.p_message as AgentRunRow["public_message"]).content, "visible final text");
  }
});

test("cached private tool results cannot bypass a fresh unavailable feature state", async (t) => {
  const features = require("../lib/app-settings") as typeof import("../lib/app-settings");
  const store = new MemoryStore(), run = row();
  const tools = await createAgentTools(store, run, run.checkpoint);
  store.drafts.set("private-profile", { id: randomUUID(), call_id: "private-profile", tool_name: "read_user_profile", kind: "tool", args: {}, result: { content: [], details: { private: true } } });
  t.mock.method(features, "isFeatureModuleEnabled", async () => true);
  t.mock.method(features, "readFeatureModuleStateFresh", async () => ({ status: "unavailable" as const }));
  await assert.rejects(tools.find(tool => tool.name === "read_user_profile")!.execute("private-profile", {}), /功能状态暂不可用/);
  await assert.rejects(tools.find(tool => tool.name === "bazi")!.execute("chart", { gender: "male", birthYear: 1990, birthMonth: 1, birthDay: 1, birthHour: 9 }), /功能状态暂不可用/);
  assert.equal(store.writes.length, 0);
});

test("recovery reuses a committed calculation result and recreates its missing toolResult once", async () => {
  const store = new MemoryStore(),
    run = row(),
    args = {
      gender: "male",
      birthYear: 1990,
      birthMonth: 1,
      birthDay: 15,
      birthHour: 9,
    };
  const assistant = emptyPiAssistant({
    id: "fixture",
    provider: "taibu",
  } as Parameters<typeof emptyPiAssistant>[0]);
  assistant.content = [
    { type: "toolCall", id: "replay", name: "bazi", arguments: args },
  ];
  assistant.stopReason = "toolUse";
  run.checkpoint.messages.push(assistant);
  const artifact: AgentArtifactRow = {
    id: randomUUID(),
    call_id: "replay",
    tool_name: "bazi",
    kind: "calculation",
    args,
    result: {
      content: [{ type: "text", text: "已提交的真实排盘" }],
      details: { original: true },
      canonicalText: "已提交的真实排盘",
    },
  };
  store.drafts.set("replay", artifact);
  await executeAgentRun(store, run, undefined, {
    config,
    streamFn: scripted((index) =>
      index === 0
        ? [{ type: "text", text: "恢复完成" }]
        : [],
    ),
  });
  assert.equal(
    store.writes.filter(
      (w) => w.name === "agent_cache_tool" && w.args.p_call_id === "replay",
    ).length,
    0,
  );
  const cp = store.writes.find((w) => w.name === "agent_finish_run")!.args
    .p_checkpoint as AgentRunRow["checkpoint"];
  assert.equal(
    cp.messages.filter(
      (m) => m.role === "toolResult" && m.toolCallId === "replay",
    ).length,
    1,
  );
});

test("truncated tool arguments and restored model errors fail without replay or falsely succeeding", async () => {
  for (const stopReason of ["length", "error"] as const) {
    const store = new MemoryStore(),
      run = row(),
      assistant = emptyPiAssistant({
        id: "fixture",
        provider: "taibu",
      } as Parameters<typeof emptyPiAssistant>[0]);
    assistant.stopReason = stopReason;
    assistant.errorMessage = "fixture failure";
    assistant.content = [
      { type: "toolCall", id: "invalid", name: "bazi", arguments: {} },
    ];
    run.checkpoint.messages.push(assistant);
    await executeAgentRun(store, run, undefined, {
      config,
      streamFn: () => {
        throw new Error("must not request again");
      },
    });
    assert.equal(
      store.writes.find((w) => w.name === "agent_finish_run")!.args.p_status,
      "failed",
    );
    assert.equal(store.drafts.size, 0);
  }
});

test("queued cancellation settles without model invocation; random seeds and native chart rules are stable", async () => {
  const store = new MemoryStore(),
    run = row();
  run.cancel_requested = true;
  await executeAgentRun(store, run, undefined, {
    config,
    streamFn: () => {
      throw new Error("must not invoke model");
    },
  });
  assert.equal(
    store.writes.find((w) => w.name === "agent_finish_run")!.args.p_status,
    "cancelled",
  );
  assert.equal(
    stableAgentSeed(run.id, "call"),
    stableAgentSeed(run.id, "call"),
  );
  assert.notEqual(
    stableAgentSeed(run.id, "call"),
    stableAgentSeed(run.id, "other"),
  );
});

test("takeover continues after a committed model response", async () => {
  const store = new MemoryStore(),
    run = row();
  const assistant = emptyPiAssistant({
    id: "fixture",
    provider: "taibu",
  } as Parameters<typeof emptyPiAssistant>[0]);
  assistant.content = [{ type: "text", text: "排盘初步分析" }];
  assistant.stopReason = "stop";
  run.checkpoint.messages.push(assistant);
  run.checkpoint.parts.push({
    type: "text",
    id: "committed",
    text: "排盘初步分析",
  });
  const inputs: string[] = [];
  await executeAgentRun(store, run, undefined, {
    config,
    streamFn: scripted(() => [{ type: "text", text: "最终分析" }], messages => {
      const last = messages.at(-1);
      if (last?.role === "user") inputs.push(typeof last.content === "string" ? last.content : JSON.stringify(last.content));
    }),
  });
  const finish = store.writes.find((w) => w.name === "agent_finish_run")!;
  assert.equal(finish.args.p_status, "completed");
  assert.deepEqual(inputs, ["接续已提交的工具结果完成用户任务。"]);
  assert.ok((finish.args.p_message as AgentRunRow["public_message"]).content.includes("最终分析"), "final analysis stays in chat history");
});

test("cached web and question results restore their public parts once before continuation", async () => {
  const previous = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = randomUUID();
  try {
    const store = new MemoryStore(),
      run = row();
    run.input.webEnabled = true;
    const results = [
      { title: "来源", url: "https://example.com/source", content: "摘要" },
    ];
    store.drafts.set("web", {
      id: randomUUID(),
      call_id: "web",
      tool_name: "web_search",
      kind: "tool",
      args: { query: "查询" },
      result: { content: [], details: results },
    });
    store.drafts.set("ask", {
      id: randomUUID(),
      call_id: "ask",
      tool_name: "ask_user",
      kind: "tool",
      args: { question: "出生时间？" },
      result: { content: [], details: { question: "出生时间？" } },
    });
    const tools = await createAgentTools(store, run, run.checkpoint);
    for (let i = 0; i < 2; i++) {
      await tools
        .find((t) => t.name === "web_search")!
        .execute("web", { query: "查询" });
      await tools
        .find((t) => t.name === "ask_user")!
        .execute("ask", { question: "出生时间？" });
    }
    assert.equal(
      run.checkpoint.parts.filter((p) => p.type === "source").length,
      1,
    );
    assert.equal(
      run.checkpoint.parts.filter((p) => p.type === "question").length,
      1,
    );
    assert.equal(run.checkpoint.question, "出生时间？");
    assert.equal(
      store.writes.length,
      0,
      "cache replay does not fetch or recache",
    );
  } finally {
    if (previous === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous;
  }
});

test("cached reads still check current feature and membership permissions", async (t) => {
  const store = new MemoryStore(),
    run = row();
  const tools = await createAgentTools(store, run, run.checkpoint);
  store.drafts.set("profile", {
    id: randomUUID(),
    call_id: "profile",
    tool_name: "read_user_profile",
    kind: "tool",
    args: {},
    result: { content: [], details: { private: true } },
  });
  const features =
    require("../lib/app-settings") as typeof import("../lib/app-settings");
  t.mock.method(
    features,
    "readFeatureModuleStateFresh",
    async (feature: Parameters<typeof features.readFeatureModuleStateFresh>[0]) =>
      ({ status: feature === "ai-personalization" ? "disabled" as const : "enabled" as const }),
  );
  await assert.rejects(
    tools.find((t) => t.name === "read_user_profile")!.execute("profile", {}),
    /个性化功能已关闭/,
  );
  const credits =
    require("../lib/user/credits") as typeof import("../lib/user/credits");
  t.mock.method(credits, "getUserCreditInfo", async () => ({
    membership: "free",
    credits: 10,
    expiresAt: null,
  }));
  await assert.rejects(
    tools
      .find((t) => t.name === "search_knowledge")!
      .execute("kb", { query: "查询" }),
    /当前会员/,
  );
});

test("lease renewal failure preserves an interrupted checkpoint for takeover", async () => {
  class InterruptedStore extends MemoryStore {
    streamingSaved = false;
    failRenewals = true;
    override async rpc<T>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<T> {
      if (name === "agent_checkpoint" && (args.p_checkpoint as AgentRunRow["checkpoint"]).streamingAssistantId)
        this.streamingSaved = true;
      // The connection drops once the streaming answer has been checkpointed.
      if (name === "agent_renew_lease" && this.failRenewals && this.streamingSaved)
        throw new Error("connection interrupted");
      return super.rpc<T>(name, args);
    }
  }
  const store = new InterruptedStore(),
    run = row();
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await executeAgentRun(store, run, undefined, {
      config,
      leaseRenewMs: 100,
      streamFn: (model, _context, options) => {
        const output = createAssistantMessageEventStream(),
          message = emptyPiAssistant(model);
        message.content = [{ type: "text", text: "中断片段" }];
        output.push({ type: "start", partial: message });
        output.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "中断片段",
          partial: message,
        });
        options!.signal!.addEventListener(
          "abort",
          () => {
            message.stopReason = "aborted";
            output.push({ type: "error", reason: "aborted", error: message });
            output.end(message);
          },
          { once: true },
        );
        return output;
      },
    });
    assert.ok(
      !store.writes.some((w) => w.name === "agent_finish_run"),
      "transient lease loss does not settle the task",
    );
    const checkpoint = store.writes
      .filter((w) => w.name === "agent_checkpoint")
      .at(-1)!.args.p_checkpoint as AgentRunRow["checkpoint"];
    assert.ok(checkpoint.streamingAssistantId);
    assert.ok(
      !checkpoint.messages.some(
        (m) => m.role === "assistant" && m.stopReason === "aborted",
      ),
    );
    run.checkpoint = checkpoint;
    run.fence++;
    // The worker that takes over has a healthy connection.
    store.failRenewals = false;
    await executeAgentRun(store, run, undefined, {
      config,
      streamFn: scripted(() => [{ type: "text", text: "接管后完成" }]),
    });
    const finish = store.writes.find((w) => w.name === "agent_finish_run")!;
    assert.equal(finish.args.p_status, "completed");
    assert.equal(
      (finish.args.p_message as AgentRunRow["public_message"]).content,
      "接管后完成",
    );
  } finally {
    clearTimeout(keepAlive);
  }
});

function streamUntilAborted(onStart?: () => void): StreamFn {
  return (model, _context, options) => {
    const output = createAssistantMessageEventStream(),
      message = emptyPiAssistant(model);
    message.content = [{ type: "text", text: "进行中" }];
    output.push({ type: "start", partial: message });
    output.push({ type: "text_delta", contentIndex: 0, delta: "进行中", partial: message });
    options!.signal!.addEventListener(
      "abort",
      () => {
        message.stopReason = "aborted";
        output.push({ type: "error", reason: "aborted", error: message });
        output.end(message);
      },
      { once: true },
    );
    onStart?.();
    return output;
  };
}

test("a cancel notification settles the run as cancelled instead of leaving it to a takeover", async () => {
  const store = new MemoryStore(),
    run = row();
  const started = Date.now();
  await executeAgentRun(store, run, undefined, {
    config,
    streamFn: streamUntilAborted(() => {
      setTimeout(() => dispatchAgentSignal({ t: "run", run: run.id, status: "cancelling", cancel: true }), 50);
    }),
  });
  const finish = store.writes.find((w) => w.name === "agent_finish_run");
  assert.equal(finish?.args.p_status, "cancelled");
  assert.ok(Date.now() - started < 5_000, "the cancel did not wait for a lease to expire");
});

test("a cancel seen only by lease renewal also stops the run gracefully", async () => {
  class CancelledStore extends MemoryStore {
    streaming = false;
    override async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      if (name === "agent_renew_lease") {
        this.writes.push({ name, args: structuredClone(args) });
        return this.streaming as T;
      }
      return super.rpc<T>(name, args);
    }
  }
  const store = new CancelledStore();
  await executeAgentRun(store, row(), undefined, {
    config,
    leaseRenewMs: 100,
    streamFn: streamUntilAborted(() => { store.streaming = true; }),
  });
  assert.equal(store.writes.find((w) => w.name === "agent_finish_run")?.args.p_status, "cancelled");
});

test("calculations alone do not complete a task: an answer without text fails", async () => {
  const store = new MemoryStore(),
    run = row();
  await executeAgentRun(store, run, undefined, {
    config,
    streamFn: scripted((index) =>
      index === 0
        ? [{ type: "toolCall", id: "calc", name: "bazi", arguments: { gender: "male", birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 } }]
        : [],
    ),
  });
  const finish = store.writes.find((w) => w.name === "agent_finish_run")!;
  assert.equal(finish.args.p_status, "failed");
  assert.equal((finish.args.p_message as AgentRunRow["public_message"]).content, "");
  assert.equal(store.calculations().length, 1, "the calculation stays in the task");
});

test("unknown Pi models carry an unknown capacity and expose native context usage in snapshots", async () => {
  const store = new MemoryStore();
  let capacity: number | undefined;
  const streamFn: StreamFn = (model, context, options) => {
    assert.match(JSON.stringify(context.messages), /<taibu_methods>/);
    capacity = model.contextWindow;
    return scripted(() => [{ type: "text", text: "chat-only result" }])(model, context, options);
  };
  await executeAgentRun(store, row(), undefined, { config, streamFn });
  assert.equal(capacity, 0, "Pi's sentinel does not invent a 32k limit");
  const finish = store.writes.find(w => w.name === "agent_finish_run")!;
  const data = (finish.args.p_message as AgentRunRow["public_message"]).agent!;
  assert.equal(data.runtime?.model.contextWindow, null);
  assert.equal(data.runtime?.model.limitSource, "unknown");
  assert.equal(data.runtime?.context?.source, "usage");
  assert.ok(data.runtime!.context!.measuredTokens > 0);
  assert.ok(data.runtime!.usage!.models['taibu/fixture'].totalTokens! > 0);
  assert.ok(store.writes.some(w => w.name === "agent_checkpoint" && (w.args.p_message as AgentRunRow["public_message"]).agent?.runtime?.context));
});

test('known contexts start background compaction below the blocking threshold while generation continues', async t => {
  const store = new MemoryStore(), run = row();
  const windows = require('../lib/ai/model-context') as typeof import('../lib/ai/model-context');
  t.mock.method(windows, 'resolveKnownModelContextConfig', () => ({ maxContext: 64000, reserveOutput: 4096 }));
  run.checkpoint.messages = Array.from({ length: 6 }, (_, index) => ({ role: 'user' as const, content: `old ${index}: ${'history '.repeat(2000)}`, timestamp: index + 1 }));
  let summaryStarted = false, summaryFinished = false, generatedWhileCompacting = false;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const safeguard = setTimeout(() => release(), 1000);
  t.after(() => clearTimeout(safeguard));
  const streamFn: StreamFn = (model, context) => {
    if (isSummaryTranscript(context)) {
      summaryStarted = true;
      const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
      void barrier.then(() => {
        summaryFinished = true;
        message.content = [{ type: 'text', text: '保留原目标与历史事实' }];
        output.push({ type: 'done', reason: 'stop', message }); output.end(message);
      });
      return output;
    }
    const tokens = estimateContextTokens(context.messages).tokens;
    assert.ok(tokens < model.contextWindow - 8096, `tokens ${tokens} must stay below the blocking line`);
    const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
    setTimeout(() => {
      generatedWhileCompacting = summaryStarted && !summaryFinished;
      release();
      setTimeout(() => {
        message.content = [{ type: 'text', text: '继续生成而不等待后台摘要' }];
        message.stopReason = 'stop';
        output.push({ type: 'done', reason: 'stop', message });
        output.end(message);
      }, 20);
    }, 30);
    return output;
  };
  await executeAgentRun(store, run, undefined, { config, streamFn });
  assert.equal(generatedWhileCompacting, true);
  assert.ok(store.nativeEntries().some(entry => entry.kind === 'pi.compaction'));
});

// Above the blocking line of a 16k window: every generation compacts first.
function blockingCompactionRun(t: TestContext) {
  const windows = require('../lib/ai/model-context') as typeof import('../lib/ai/model-context');
  t.mock.method(windows, 'resolveKnownModelContextConfig', () => ({ maxContext: 16000, reserveOutput: 4096 }));
  const run = row();
  run.checkpoint.messages = Array.from({ length: 6 }, (_, index) => ({ role: 'user' as const, content: `old ${index}: ${'history '.repeat(2000)}`, timestamp: index + 1 }));
  return run;
}

function failedStream(model: Parameters<StreamFn>[0]) {
  const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
  message.stopReason = 'error';
  message.errorMessage = 'summary provider unavailable';
  output.push({ type: 'error', reason: 'error', error: message });
  output.end(message);
  return output;
}

test('a failed blocking compaction fails the task with the context message and never calls the main model', async t => {
  const store = new MemoryStore(), run = blockingCompactionRun(t);
  let answers = 0, summaries = 0;
  const streamFn: StreamFn = (model, context) => {
    // Generations offer tools; summaries do not. Pi's built-in summarizer retries after taibu's fails.
    if (getCurrentTools(context.messages).length) answers++; else summaries++;
    return failedStream(model);
  };
  await executeAgentRun(store, run, undefined, { config, streamFn });
  assert.equal(answers, 0, 'the generation waits for its blocking compaction');
  assert.equal(summaries, 2);
  const finish = store.writes.find(w => w.name === 'agent_finish_run')!;
  assert.equal(finish.args.p_status, 'failed');
  const agent = (finish.args.p_message as AgentRunRow['public_message']).agent!;
  assert.equal(agent.error, AGENT_COMPACTION_FAILED_MESSAGE);
  assert.equal(agent.compactions?.length, 1);
  assert.equal(agent.compactions?.[0].status, 'failed');
});

test("Pi's built-in summary settles a compaction whose taibu summary failed", async t => {
  const store = new MemoryStore(), run = blockingCompactionRun(t);
  const answer = scripted(() => [{ type: 'text', text: '压缩后继续作答' }]);
  const streamFn: StreamFn = (model, context, options) => {
    if (isSummaryTranscript(context)) return failedStream(model);
    if (getCurrentTools(context.messages).length) return answer(model, context, options);
    const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
    message.content = [{ type: 'text', text: '## Goal\n内置摘要保留用户目标' }];
    output.push({ type: 'done', reason: 'stop', message });
    output.end(message);
    return output;
  };
  await executeAgentRun(store, run, undefined, { config, streamFn });
  const finish = store.writes.find(w => w.name === 'agent_finish_run')!;
  assert.equal(finish.args.p_status, 'completed');
  const [record] = (finish.args.p_message as AgentRunRow['public_message']).agent!.compactions!;
  assert.equal(record.status, 'completed');
  assert.equal(record.summary, '## Goal\n内置摘要保留用户目标');
  assert.equal(record.reason, undefined);
});

test('Tarot implicit seeds satisfy Core schema and durable hooks block overrides before calculation', async () => {
  const store = new MemoryStore(), run = row();
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(index => index === 0
    ? [{ type: 'toolCall', id: 'blocked', name: 'tarot', arguments: { seed: 'model-seed' } }]
    : index === 1 ? [{ type: 'toolCall', id: 'draw', name: 'tarot', arguments: { spreadType: 'single', referenceYear: '2026' } }]
    : [{ type: 'text', text: '按实际牌面解读' }]) });
  assert.equal(store.draft('blocked'), undefined);
  assert.ok(store.draft('draw'));
  const results = store.nativeEntries().flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult');
  assert.ok(results.some(message => message.role === 'toolResult' && message.toolCallId === 'blocked' && message.isError));
  assert.ok(results.some(message => message.role === 'toolResult' && message.toolCallId === 'draw' && !message.isError && message.content.some(part => part.type === 'text' && part.text.includes(`命盘引用: artifact:${store.draft('draw')!.id}`))));
});

test('a disabled Agent tool scope stays registered and reports the policy reason to the model', async t => {
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  t.mock.method(settings, 'readFeatureModuleStateFresh', async (featureId: string) => ({
    status: featureId === 'agent-tool:bazi' ? 'disabled' as const : 'enabled' as const,
  }));
  const store = new MemoryStore();
  await executeAgentRun(store, row(), undefined, { config, streamFn: scripted(index => index === 0
    ? [{ type: 'toolCall', id: 'blocked-bazi', name: 'bazi', arguments: { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 1, birthHour: 9 } }]
    : [{ type: 'text', text: '已根据权限调整' }]) });
  const result = store.nativeEntries()
    .flatMap(entry => entry.model ?? [])
    .filter(message => message.role === 'toolResult')
    .find(message => message.toolCallId === 'blocked-bazi');
  assert.ok(result);
  assert.ok(result.isError);
  assert.ok(result.content.some(part => part.type === 'text' && part.text.includes('八字工具')));
});

test("unknown capacity still uses Pi's bounded compaction recovery on a reported overflow", async () => {
  const store = new MemoryStore(), run = row();
  run.checkpoint.messages = Array.from({ length: 5 }, (_, index) => ({ role: "user" as const, content: `old turn ${index}: ${"history ".repeat(5000)}`, timestamp: index + 1 }));
  let calls = 0;
  const streamFn: StreamFn = (model, context, options) => {
    if (isSummaryTranscript(context)) return scripted(() => [])(model, context, options);
    assert.equal(model.contextWindow, 0);
    const stream = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
    if (calls++ === 0) {
      message.stopReason = "error";
      message.errorMessage = "context_length_exceeded";
      stream.push({ type: "error", reason: "error", error: message });
    } else {
      message.content = [{ type: "text", text: "recovered answer" }];
      message.usage.input = 100;
      message.usage.totalTokens = 100;
      stream.push({ type: "done", reason: "stop", message });
    }
    stream.end(message);
    return stream;
  };
  await executeAgentRun(store, run, undefined, { config, streamFn });
  assert.equal(calls, 2);
  assert.ok(store.nativeEntries().some(entry => entry.kind === "pi.compaction"));
  const finish = store.writes.find(w => w.name === "agent_finish_run")!;
  assert.equal(finish.args.p_status, "completed");
  assert.equal((finish.args.p_message as AgentRunRow["public_message"]).agent?.runtime?.context?.compactions, 1);
});

test('unsupported checkpoint engines are rejected before opening storage or invoking a model or tool', async () => {
  for (const checkpoint of [{ version: 1 }, { version: 2 }, { version: 2, durable: { engine: 'pi-durable/1.0.4' } }, { version: 2, durable: { engine: 'pi-durable/1.1.0' } }, { version: 2, durable: { engine: 'pi-durable/1.3.0' } }, { version: 2, durable: { engine: 'pi-durable/9.9.9' } }]) {
    const store = new MemoryStore(), run = row();
    run.checkpoint = { ...run.checkpoint, ...checkpoint } as AgentRunRow['checkpoint'];
    if (!('durable' in checkpoint)) delete (run.checkpoint as Partial<AgentRunRow['checkpoint']>).durable;
    await assert.rejects(executeAgentRun(store, run, undefined, { config, streamFn: () => { throw new Error('model must not run'); } }), /AGENT_ENGINE_UNSUPPORTED/);
    assert.equal(store.writes.length, 0);
    assert.equal(store.drafts.size, 0);
  }
});

/** A model reply that fails with `errorMessage` before any output. */
function failedAnswer(model: Parameters<StreamFn>[0], errorMessage: string) {
  const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
  message.stopReason = 'error';
  message.errorMessage = errorMessage;
  output.push({ type: 'error', reason: 'error', error: message });
  output.end(message);
  return output;
}

test('a request every source failed transiently sleeps durably and is retried; any other failure is not', async () => {
  // Every clock read is four seconds later, so a backoff sleep is due as soon as Pi looks again.
  let clock = Date.now();
  const now = () => (clock += 4000);
  for (const [errorMessage, expected] of [[AGENT_TRANSIENT_ERROR_MESSAGE, 'completed'], ['模型调用失败，请确认模型支持工具调用或切换普通对话', 'failed']] as const) {
    const store = new MemoryStore();
    let calls = 0;
    const answer = scripted(() => [{ type: 'text', text: '重试后完成' }]);
    await executeAgentRun(store, row(), undefined, { config, now, streamFn: (model, context, options) =>
      calls++ === 0 ? failedAnswer(model, errorMessage) : answer(model, context, options) });
    assert.equal(store.writes.find(w => w.name === 'agent_finish_run')!.args.p_status, expected, errorMessage);
    assert.equal(calls, expected === 'completed' ? 2 : 1);
    if (expected === 'completed') assert.ok(store.log.flatMap(c => c.writes).some(w => w.type === 'task' && w.value.state.status === 'sleeping'), 'the backoff is a durable sleep');
  }
});

test('a message steered in while an answer fails starts the next answer instead of being dropped', async () => {
  const store = new MemoryStore(), run = row();
  const contexts: string[] = [];
  let calls = 0;
  const answer = scripted(() => [{ type: 'text', text: '已按补充回答' }], messages => { contexts.push(JSON.stringify(messages)); });
  await executeAgentRun(store, run, undefined, { config, streamFn: (model, context, options) => {
    if (calls++) return answer(model, context, options);
    store.pending = [{ sequence: 3, mode: 'steer', message: { id: 'steer', role: 'user', content: '另外看看事业', createdAt: '2026-10-24T15:51:30.000Z' } }];
    dispatchAgentSignal({ t: 'cmd', run: run.id });
    const output = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
    // The failure lands once the steer is queued behind this answer.
    setTimeout(() => {
      message.stopReason = 'error';
      message.errorMessage = 'fixture failure';
      output.push({ type: 'error', reason: 'error', error: message });
      output.end(message);
    }, 200);
    return output;
  } });
  const finish = store.writes.find(w => w.name === 'agent_finish_run')!;
  assert.equal(finish.args.p_status, 'completed', JSON.stringify(finish.args.p_message));
  assert.equal(calls, 2);
  // Dated when the server received it, in the zone the task was created in.
  assert.ok(contexts[0].includes('【发送时间：2026-10-24 23:51 星期六，Asia/Shanghai（UTC+08:00）】\\n另外看看事业'), contexts[0]);
  assert.deepEqual(store.pending, [], 'the steer was placed, not left queued');
});

test('a step that takes its worker down five times in a row is parked and the task fails instead of looping', async () => {
  class CrashingStore extends MemoryStore {
    crashed = false;
    // The worker dies while the bazi call runs: no later commit of that process is acknowledged.
    override async artifact(run: AgentRunRow, callId: string) {
      const found = await super.artifact(run, callId);
      if (found?.tool_name === 'bazi') this.crashed = true;
      return found;
    }
    override async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      if (name === 'agent_durable_commit' && this.crashed) throw new Error('worker died');
      const result = await super.rpc<T>(name, args);
      if (name === 'agent_cache_tool' && args.p_tool_name === 'bazi') this.crashed = true;
      return result;
    }
  }
  const store = new CrashingStore(), run = row();
  const streamFn = scripted(index => index === 0
    ? [{ type: 'toolCall', id: 'crash', name: 'bazi', arguments: { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 } }]
    : [{ type: 'text', text: '不应作答' }]);
  const warnings: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  const keepAlive = setTimeout(() => {}, 30_000);
  try {
    // The first run and four takeovers each die in the call; the sixth worker finds it cut off five times.
    for (let attempt = 0; attempt < 5; attempt++) {
      store.crashed = false;
      await executeAgentRun(store, run, undefined, { config, streamFn });
      assert.ok(!store.writes.some(w => w.name === 'agent_finish_run'), `attempt ${attempt} is left to a takeover`);
      run.checkpoint = store.writes.filter(w => w.name === 'agent_durable_commit' || w.name === 'agent_checkpoint').at(-1)!.args.p_checkpoint as AgentRunRow['checkpoint'];
      run.fence++;
    }
    store.crashed = false;
    await executeAgentRun(store, run, undefined, { config, streamFn });
  } finally {
    clearTimeout(keepAlive);
    console.warn = warn;
  }
  const finish = store.writes.find(w => w.name === 'agent_finish_run')!;
  assert.equal(finish.args.p_status, 'failed');
  assert.equal((finish.args.p_message as AgentRunRow['public_message']).agent?.error, AGENT_RESTART_LIMIT_MESSAGE);
  assert.ok(warnings.some(entry => JSON.stringify(entry).includes('"code":"task_parked"')), 'the parked task is reported by kind, without its error');
});

test('Pi reports are logged by type and place, never with the error text', () => {
  const task = { id: 7, kind: 'pi.tool', conversationId: 1 } as unknown as Parameters<typeof agentReportFields>[1] extends infer I ? I extends { task: infer T } ? T : never : never;
  assert.deepEqual(agentReportFields('run', { type: 'task_faulted', task, extension: 'taibu', reason: 'threw' }),
    { runId: 'run', code: 'task_faulted', task: 'pi.tool', taskId: 7, extension: 'taibu', reason: 'threw' });
  assert.deepEqual(agentReportFields('run', { type: 'host_error', callback: 'now' }), { runId: 'run', code: 'host_error', callback: 'now' });
  assert.deepEqual(agentReportFields('run', { type: 'session_failed' }), { runId: 'run', code: 'session_failed' });
});
