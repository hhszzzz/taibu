import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AgentRunTelemetry } from "../lib/agent/telemetry.server";
import { AGENT_RUN_PHASE_LIMIT } from "../lib/agent/telemetry.server";
import { executeAgentRun } from "../lib/agent/runtime.server";
import { config, row, MemoryStore, scripted } from "./helpers/agent-runtime-fixture";

beforeEach((t) => {
  assert.ok("mock" in t);
  const settings = require("../lib/app-settings") as typeof import("../lib/app-settings");
  const sdk = require("../lib/ai/providers/ai-sdk-provider") as typeof import("../lib/ai/providers/ai-sdk-provider");
  t.mock.method(settings, "readFeatureModuleStateFresh", async () => ({ status: "enabled" as const }));
  t.mock.method(sdk, "isModelAvailable", () => true);
});

const USAGE = {
  input: 100, output: 50, cacheRead: 30, cacheWrite: 10, totalTokens: 190,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("the adapter aggregates phases, retries, reports, tokens and the first token", async () => {
  let clock = 1_000;
  const telemetry = new AgentRunTelemetry({ runId: "run-1", modelId: "fixture", startedAt: 1_000, queuedMs: 250, now: () => clock });
  const duration = telemetry.metrics.histogram("pi.durable.phase.duration");
  duration.record(1_000, { task: "pi.generation", phase: "request", outcome: "next=tools" });
  duration.record(400, { task: "pi.tool", phase: "call", outcome: "done" });
  duration.record(50, { task: "pi.compaction", phase: "summarize", outcome: "done" });
  duration.record(20, { task: "pi.tool", phase: "execute", outcome: "done" });
  duration.record(900, { task: "taibu.background.anchor", phase: "run", outcome: "done" });
  const reports = telemetry.metrics.counter("pi.durable.reports");
  reports.add(1, { type: "task_faulted" });
  reports.add(2, { type: "task_interrupted" });
  reports.add(5, { type: "not-a-report" });

  await telemetry.startSpan({ name: "pi.durable.phase", attributes: {
    "task.id": 7, "task.name": "pi.generation", phase: "request", kind: "run", resumed: false, attempt: 1,
  } }, span => {
    clock += 500;
    span.addEvent("pi.durable.submission", { "submission.id": 1, status: "done", "answer.entry_id": 4 });
    span.setAttributes({ outcome: "next=tools" });
  });
  await telemetry.startSpan({ name: "pi.durable.phase", attributes: {
    "task.id": 7, "task.name": "pi.generation", phase: "request", kind: "run", resumed: false, attempt: 2,
  } }, span => { clock += 300; span.setAttributes({ outcome: "done" }); });
  await telemetry.startSpan({ name: "pi.durable.submit", attributes: {
    "submission.type": "input", "conversation.id": 1,
  } }, span => { clock += 20; span.setAttributes({ result: "queued", "submission.id": 9 }); });
  await telemetry.startSpan({ name: "pi.durable.submit", attributes: {
    "submission.type": "write", "conversation.id": 1,
  } }, () => {});
  clock += 200;
  telemetry.firstToken();
  telemetry.firstToken();
  telemetry.usage(USAGE);
  clock += 800;

  const metrics = telemetry.snapshot("completed");
  assert.equal(metrics.runId, "run-1");
  assert.equal(metrics.modelId, "fixture");
  assert.equal(metrics.status, "completed");
  assert.equal(metrics.queuedMs, 250);
  assert.equal(metrics.totalMs, 1_820);
  assert.equal(metrics.firstTokenMs, 1_020, "the first content is kept; later calls do not move it");
  assert.deepEqual([metrics.generationCount, metrics.generationMs], [1, 1_000]);
  assert.deepEqual([metrics.toolCount, metrics.toolMs], [2, 420], "the call phase runs the tool; execute is its recovery replay");
  assert.deepEqual([metrics.compactionCount, metrics.compactionMs], [1, 50]);
  assert.equal(metrics.retries, 1, "the second attempt of the same generation counts once");
  assert.equal(metrics.faults, 1);
  assert.equal(metrics.hangs, 2);
  assert.deepEqual([metrics.inputTokens, metrics.outputTokens, metrics.cacheReadTokens, metrics.cacheWriteTokens, metrics.totalTokens],
    [100, 50, 30, 10, 190]);
  assert.equal(metrics.phases.length, 4, "two phase spans, a settled submission and the input submission; the write admission is not a phase");
  assert.deepEqual(metrics.phases.map(phase => phase.name), ["pi.durable.submission", "pi.durable.phase", "pi.durable.phase", "pi.durable.submit"]);
  assert.equal(metrics.phases[1]?.outcome, "next=tools");
  assert.equal(metrics.phases[2]?.outcome, "done");
  assert.equal(metrics.phases[0]?.submissionStatus, "done");
  assert.equal(metrics.phases[3]?.result, "queued");
  assert.equal(metrics.startedAt, new Date(1_000).toISOString());
  assert.equal(metrics.endedAt, new Date(2_820).toISOString());
});

test("the adapter stores only whitelisted identifiers, never attributes that carry content", async () => {
  const telemetry = new AgentRunTelemetry({ runId: "run-2", modelId: "fixture", startedAt: 0, now: () => 10 });
  await telemetry.startSpan({ name: "pi.durable.phase", attributes: {
    "task.id": 1, "task.name": "pi.generation", phase: "request", kind: "run", resumed: false,
    message: "SECRET-MESSAGE", "tool.arguments": "SECRET-ARGUMENTS", prompt: "SECRET-PROMPT",
  } }, span => {
    span.addEvent("pi.durable.report", { type: "task_error", message: "SECRET-REPORT" });
    span.addEvent("pi.durable.submission", { "submission.id": 3, status: "unanswered", detail: "SECRET-SUBMISSION" });
    span.addEvent("pi.durable.entry", { "entry.kind": "SECRET-ENTRY", "entry.id": 3 });
    span.setAttributes({ outcome: "done", "tool.name": "SECRET-TOOL", "tool.call_id": "SECRET-CALL", "entry.kind": "SECRET-KIND" });
  });
  const metrics = telemetry.snapshot("failed");
  const stored = JSON.stringify(metrics);
  assert.doesNotMatch(stored, /SECRET/u);
  const phase = metrics.phases.find(item => item.name === "pi.durable.phase");
  assert.deepEqual(Object.keys(phase ?? {}).sort(), ["durationMs", "name", "outcome", "phase", "startMs", "status", "task"]);
  assert.ok(metrics.phases.some(item => item.name === "pi.durable.submission" && item.submissionStatus === "unanswered"));
});

test("the adapter keeps a bounded timeline", async () => {
  const telemetry = new AgentRunTelemetry({ runId: "run-3", modelId: "fixture", startedAt: 0, now: () => 1 });
  for (let index = 0; index < AGENT_RUN_PHASE_LIMIT + 20; index += 1) {
    await telemetry.startSpan({ name: "pi.durable.phase", attributes: {
      "task.id": index, "task.name": "pi.tool", phase: "call", kind: "run", resumed: false,
    } }, () => {});
  }
  assert.equal(telemetry.snapshot("completed").phases.length, AGENT_RUN_PHASE_LIMIT);
});

test("a completed run writes one metrics row", async () => {
  const store = new MemoryStore();
  const run = row();
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => [{ type: "text", text: "完成。" }]) });
  assert.equal(store.metrics.length, 1);
  assert.equal(store.metrics[0]?.runId, run.id);
  assert.equal(store.metrics[0]?.status, "completed");
  assert.ok((store.metrics[0]?.generationCount ?? 0) >= 1, "a generation phase is recorded");
  assert.ok((store.metrics[0]?.phases.length ?? 0) >= 1, "the phase timeline is recorded");
});

test("a failed run writes a failed metrics row", async (t) => {
  const settings = require("../lib/app-settings") as typeof import("../lib/app-settings");
  t.mock.method(settings, "readFeatureModuleStateFresh", async () => ({ status: "disabled" as const }));
  const store = new MemoryStore();
  await executeAgentRun(store, row(), undefined, { config, streamFn: scripted(() => [{ type: "text", text: "不能执行" }]) });
  assert.equal(store.metrics.length, 1);
  assert.equal(store.metrics[0]?.status, "failed");
});

test("a cancelled run writes a cancelled metrics row", async () => {
  const store = new MemoryStore();
  const run = row();
  run.cancel_requested = true;
  await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => [{ type: "text", text: "不应运行" }]) });
  assert.equal(store.metrics.length, 1);
  assert.equal(store.metrics[0]?.status, "cancelled");
  assert.equal(store.metrics[0]?.totalTokens, 0);
});

test("an awaiting-input run writes no metrics row until it ends", async () => {
  const store = new MemoryStore();
  await executeAgentRun(store, row(), undefined, { config, streamFn: scripted(() => [{
    type: "toolCall", id: "question", name: "ask_user", arguments: { question: "出生时间？" },
  }]) });
  assert.equal(store.metrics.length, 0);
});
