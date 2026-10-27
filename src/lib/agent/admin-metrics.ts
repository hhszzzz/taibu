/** A run's terminal status: metrics are written only when the run ends. */
export type AgentRunMetricStatus = 'completed' | 'failed' | 'cancelled';

/**
 * One whitelisted span of a run, in the order Pi Durable emitted it.
 * Only phase and admission identifiers are kept: never a message, a tool argument or a result.
 */
export interface AgentRunPhase {
  name: 'pi.durable.phase' | 'pi.durable.submit' | 'pi.durable.submission';
  /** Registered task name, e.g. pi.generation or pi.tool. */
  task?: string;
  /** The task's checkpoint phase at invocation. */
  phase?: string;
  /** Checkpoint attempt of a generation or compaction retry. */
  attempt?: number;
  /** Where the phase went: done, waiting, sleeping, faulted, aborted or next=<phase>. */
  outcome?: string;
  /** An input submission's admission result. */
  result?: 'queued' | 'placed' | 'done';
  /** Present on an input submission span. */
  submissionType?: 'input';
  /** Present on a submission settlement event. */
  submissionStatus?: 'done' | 'unanswered';
  status: 'ok' | 'error';
  /** Milliseconds from the run's execution start. */
  startMs: number;
  durationMs: number;
}

/** One row of agent_run_metrics: what a run cost in time, retries, faults and tokens. */
export interface AgentRunMetricsRow {
  runId: string;
  modelId: string;
  status: AgentRunMetricStatus;
  /** Time the run waited between its creation and the worker that executed this segment claiming it. */
  queuedMs: number;
  /** Wall-clock time of this execution segment. */
  totalMs: number;
  firstTokenMs: number | null;
  generationCount: number;
  generationMs: number;
  toolCount: number;
  toolMs: number;
  compactionCount: number;
  compactionMs: number;
  /** Generation attempts beyond the first. */
  retries: number;
  /** Reports Pi raised other than a parked task. */
  faults: number;
  /** Times Pi parked a task (its crash-loop guard). */
  hangs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  phases: AgentRunPhase[];
  startedAt: string;
  endedAt: string;
}

/** Per-model aggregates over a window, as the settings center's performance view shows them. */
export interface AgentRunMetricsSummary {
  modelId: string;
  runs: number;
  p50TotalMs: number;
  p95TotalMs: number;
  p50FirstTokenMs: number | null;
  p95FirstTokenMs: number | null;
  /** Tool phase time over total run time, 0–1. */
  toolShare: number;
  failureRate: number;
  hangRate: number;
}

/** A recent run in the performance view; its phase timeline is read on demand. */
export interface AgentRunMetricsRecent {
  runId: string;
  modelId: string;
  status: AgentRunMetricStatus;
  totalMs: number;
  firstTokenMs: number | null;
  toolMs: number;
  retries: number;
  faults: number;
  hangs: number;
  endedAt: string;
}

/** `GET /api/admin/agent-metrics`: per-model percentiles and the newest runs in the window. */
export interface AgentRunMetricsReport {
  /** The window in days: 1, 7 or 30. */
  days: number;
  /** Inclusive start of the window. */
  since: string;
  models: AgentRunMetricsSummary[];
  runs: AgentRunMetricsRecent[];
}

export const AGENT_METRICS_DAYS: readonly number[] = [1, 7, 30];

/** A duration as the Agent settings pages write it. */
export function formatAgentDuration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} 毫秒`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} 秒`;
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
}
