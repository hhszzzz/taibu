import "server-only";
import type { Usage } from "@earendil-works/pi-ai";
import type {
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetryCounter,
  TelemetryHistogram,
  TelemetryMetrics,
  TelemetrySpan,
  TelemetryUpDownCounter,
} from "@earendil-works/pi-telemetry";
import type { AgentRunMetricStatus, AgentRunMetricsRow, AgentRunPhase } from "./admin-metrics";

/** A run keeps its newest 500 phases; a long task's timeline stays bounded but still shows how it ended. */
export const AGENT_RUN_PHASE_LIMIT = 500;

/** The span and event names and the report types Pi Durable's content-free vocabulary defines. */
const PHASE_SPAN = "pi.durable.phase";
const SUBMIT_SPAN = "pi.durable.submit";
const PHASE_TASKS = new Set(["pi.generation", "pi.tool", "pi.compaction"]);
const REPORT_PARKED = "task_parked";
const REPORT_TYPES = new Set([
  "session_failed", "task_faulted", "task_parked", "migration_failed", "task_outdated",
  "task_error", "extension_error", "host_error", "listener_error",
]);
const SUBMISSION_RESULTS = new Set(["queued", "placed", "done"]);
const SUBMISSION_STATUSES = new Set(["done", "unanswered"]);
const TASK_NAME = /^[a-z][a-z0-9._-]{0,63}$/u;
const PHASE_NAME = /^[a-z][a-z0-9_-]{0,31}$/u;
const OUTCOME = /^(?:done|waiting|sleeping|faulted|aborted|next=[a-z][a-z0-9_-]{0,31})$/u;

/** Receives what a model request produced, from `pi-stream.server.ts`. */
export interface AgentStreamTelemetry {
  /** The first content of the run has been streamed. */
  firstToken(): void;
  /** One request's usage; each turn adds its own, cache reads included. */
  usage(usage: Usage): void;
}

function stringAttribute(attributes: SpanAttributes, key: string, pattern: RegExp): string | undefined {
  const value = attributes[key];
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function numberAttribute(attributes: SpanAttributes, key: string): number | undefined {
  const value = attributes[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function measure(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function milliseconds(value: number): number {
  return Math.max(0, Math.round(measure(value)));
}

export interface AgentRunTelemetryOptions {
  runId: string;
  modelId: string;
  /** Wall-clock start of this execution segment; defaults to now. */
  startedAt?: number;
  /** Milliseconds between the run's creation and this execution segment's claim. */
  queuedMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * Adapts Pi Durable's content-free telemetry into one run's metrics. The adapter is created per execution, so every
 * span, metric and report it receives belongs to that run. It keeps only identifiers and durations: the phase and
 * submission names, their phase, attempt, outcome and result, and the run's own timestamps. Messages, tool arguments,
 * tool results, instructions and secrets are never read, even when an attribute carries them.
 */
export class AgentRunTelemetry implements TelemetryContext, AgentStreamTelemetry {
  readonly metrics: TelemetryMetrics;
  private readonly runId: string;
  private readonly modelId: string;
  private readonly startedAt: number;
  private readonly queuedMs: number;
  private readonly now: () => number;
  private readonly phases: AgentRunPhase[] = [];
  /** Highest attempt seen per generation task, so a retried generation counts once per retry. */
  private readonly generationAttempts = new Map<string, number>();
  private generationCount = 0;
  private generationMs = 0;
  private toolCount = 0;
  private toolMs = 0;
  private compactionCount = 0;
  private compactionMs = 0;
  private retries = 0;
  private faults = 0;
  private hangs = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private totalTokens = 0;
  private firstTokenMs: number | undefined;

  constructor(options: AgentRunTelemetryOptions) {
    this.runId = options.runId;
    this.modelId = options.modelId;
    this.startedAt = options.startedAt ?? Date.now();
    this.queuedMs = Math.max(0, options.queuedMs ?? 0);
    this.now = options.now ?? Date.now;
    // Pi Durable asks for these instruments while opening the Harness; unknown names stay no-ops.
    const noopCounter: TelemetryCounter = { add: () => {} };
    const noopHistogram: TelemetryHistogram = { record: () => {} };
    this.metrics = {
      counter: (name: string): TelemetryCounter => name === "pi.durable.reports"
        ? { add: (value, attributes) => this.recordReport(value, attributes) }
        : noopCounter,
      upDownCounter: (): TelemetryUpDownCounter => noopCounter,
      histogram: (name: string): TelemetryHistogram => name === "pi.durable.phase.duration"
        ? { record: (value, attributes) => this.recordPhaseDuration(value, attributes) }
        : noopHistogram,
    };
  }

  /** Pi Durable opens a root span per phase invocation and one per public submission. */
  startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
    return this.runSpan(options, callback);
  }

  private async runSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
    const startedAt = this.now();
    const attributes: SpanAttributes = { ...options.attributes };
    let status: SpanStatus = { status: "ok" };
    const span: TelemetrySpan = {
      metrics: this.metrics,
      startSpan: (childOptions, childCallback) => this.runSpan(childOptions, childCallback),
      addLink: () => {},
      addEvent: (name, eventAttributes) => this.recordEvent(name, eventAttributes, startedAt),
      setAttributes: next => { Object.assign(attributes, next); },
      setStatus: next => { status = next; },
    };
    const record = () => {
      const durationMs = milliseconds(this.now() - startedAt);
      const startMs = milliseconds(startedAt - this.startedAt);
      this.recordSpan(options.name, attributes, status.status === "error" ? "error" : "ok", startMs, durationMs);
    };
    try {
      const result = await callback(span);
      record();
      return result;
    } catch (error) {
      record();
      throw error;
    }
  }

  /** Only the two content-free Pi Durable spans are kept; storage and other child spans stay invisible. */
  private recordSpan(name: string, attributes: SpanAttributes, status: AgentRunPhase["status"], startMs: number, durationMs: number) {
    if (name === PHASE_SPAN) {
      const task = stringAttribute(attributes, "task.name", TASK_NAME);
      const phase = stringAttribute(attributes, "phase", PHASE_NAME);
      const attempt = numberAttribute(attributes, "attempt");
      const outcome = stringAttribute(attributes, "outcome", OUTCOME);
      if (task === "pi.generation" && attempt !== undefined) this.countAttempt(attributes["task.id"], attempt);
      this.pushPhase({ name: PHASE_SPAN, ...(task ? { task } : {}), ...(phase ? { phase } : {}),
        ...(attempt !== undefined ? { attempt } : {}), ...(outcome ? { outcome } : {}), status, startMs, durationMs });
      return;
    }
    if (name === SUBMIT_SPAN) {
      // Write admissions are internal commits; the run's own inputs are the submissions worth a timeline entry.
      if (attributes["submission.type"] !== "input") return;
      const result = typeof attributes.result === "string" && SUBMISSION_RESULTS.has(attributes.result)
        ? attributes.result as AgentRunPhase["result"] : undefined;
      this.pushPhase({ name: SUBMIT_SPAN, submissionType: "input", ...(result ? { result } : {}), status, startMs, durationMs });
    }
  }

  /** A settled submission is the second half of the submit signal; the entry and report events stay out. */
  private recordEvent(name: string, attributes: SpanAttributes | undefined, spanStartedAt: number) {
    if (name !== "pi.durable.submission" || !attributes) return;
    const status = attributes.status;
    if (typeof status !== "string" || !SUBMISSION_STATUSES.has(status)) return;
    this.pushPhase({ name: "pi.durable.submission", submissionStatus: status as AgentRunPhase["submissionStatus"],
      status: "ok", startMs: milliseconds(spanStartedAt - this.startedAt), durationMs: 0 });
  }

  private countAttempt(taskIdValue: SpanAttributes[string], attempt: number) {
    const taskId = typeof taskIdValue === "number" ? String(taskIdValue) : "?";
    const previous = this.generationAttempts.get(taskId) ?? 1;
    if (attempt > previous) this.retries += attempt - previous;
    this.generationAttempts.set(taskId, Math.max(previous, attempt));
  }

  /**
   * `pi.durable.phase.duration` histograms each phase invocation. A generation's model request is its `request`
   * phase, a compaction's summary call its `summarize` phase. A tool runs inside its task's `call` phase; `execute`
   * is only the recovery replay after an interruption, which is also a real attempt. Those phases count as one
   * generation, tool call or compaction and carry the phase time.
   */
  private recordPhaseDuration(value: number, attributes?: SpanAttributes) {
    if (!attributes) return;
    const task = stringAttribute(attributes, "task", TASK_NAME);
    const phase = stringAttribute(attributes, "phase", PHASE_NAME);
    if (!task || !phase || !PHASE_TASKS.has(task)) return;
    const duration = milliseconds(value);
    if (task === "pi.generation" && phase === "request") { this.generationCount += 1; this.generationMs += duration; }
    else if (task === "pi.tool" && (phase === "call" || phase === "execute")) { this.toolCount += 1; this.toolMs += duration; }
    else if (task === "pi.compaction" && phase === "summarize") { this.compactionCount += 1; this.compactionMs += duration; }
  }

  /** `pi.durable.reports`: a parked task is a hang; every other report is a fault. */
  private recordReport(value: number, attributes?: SpanAttributes) {
    const type = attributes?.type;
    if (typeof type !== "string" || !REPORT_TYPES.has(type) || !Number.isFinite(value) || value <= 0) return;
    if (type === REPORT_PARKED) this.hangs += value;
    else this.faults += value;
  }

  private pushPhase(phase: AgentRunPhase) {
    this.phases.push(phase);
    if (this.phases.length > AGENT_RUN_PHASE_LIMIT) this.phases.shift();
  }

  firstToken() {
    if (this.firstTokenMs === undefined) this.firstTokenMs = Math.max(0, this.now() - this.startedAt);
  }

  usage(value: Usage) {
    this.inputTokens += measure(value.input);
    this.outputTokens += measure(value.output);
    this.cacheReadTokens += measure(value.cacheRead);
    this.cacheWriteTokens += measure(value.cacheWrite);
    this.totalTokens += measure(value.totalTokens);
  }

  /** The row to write when the run reaches a terminal state. */
  snapshot(status: AgentRunMetricStatus): AgentRunMetricsRow {
    const endedAt = this.now();
    return {
      runId: this.runId,
      modelId: this.modelId,
      status,
      queuedMs: milliseconds(this.queuedMs),
      totalMs: milliseconds(endedAt - this.startedAt),
      firstTokenMs: this.firstTokenMs === undefined ? null : milliseconds(this.firstTokenMs),
      generationCount: this.generationCount,
      generationMs: this.generationMs,
      toolCount: this.toolCount,
      toolMs: this.toolMs,
      compactionCount: this.compactionCount,
      compactionMs: this.compactionMs,
      retries: this.retries,
      faults: this.faults,
      hangs: this.hangs,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      totalTokens: this.totalTokens,
      phases: structuredClone(this.phases),
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
    };
  }
}
