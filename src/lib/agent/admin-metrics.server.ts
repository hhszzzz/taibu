import "server-only";
import type { ScopedDb } from "@/lib/db/context.server";
import {
  AGENT_METRICS_DAYS,
  type AgentRunMetricStatus, type AgentRunMetricsRecent, type AgentRunMetricsReport,
  type AgentRunMetricsRow, type AgentRunMetricsSummary, type AgentRunPhase,
} from "./admin-metrics";

/** Newest runs the performance view lists under the per-model aggregates. */
export const AGENT_METRICS_RUN_LIMIT = 50;

/** A requested window; anything else (a missing or malformed query) reads seven days. */
export function agentMetricsDays(value: string | null): number {
  const parsed = Number(value);
  return AGENT_METRICS_DAYS.includes(parsed) ? parsed : 7;
}

export function isAgentRunMetricStatus(value: unknown): value is AgentRunMetricStatus {
  return value === "completed" || value === "failed" || value === "cancelled";
}

function numberOr(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : numberOr(value);
}

/**
 * Per-model percentiles over a window: total run time, time to first token, tool-time share, failure rate and hang
 * rate, plus the newest runs. Metrics are admin-only; the route checks the administrator before calling this.
 */
export async function readAgentMetricsForAdmin(db: ScopedDb, days: number): Promise<AgentRunMetricsReport> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [models, runs] = await Promise.all([
    // Percentiles stay in SQL so the window is aggregated without reading every row into the app.
    db.rpc("agent_run_metrics_summary", { p_days: days }, { timeoutMs: 30_000 }),
    db.tx(trx => trx.selectFrom("agent_run_metrics")
      .select(["run_id", "model_id", "status", "total_ms", "first_token_ms", "tool_ms", "retries", "faults", "hangs", "ended_at"])
      .where("ended_at", ">=", since)
      .orderBy("ended_at", "desc")
      .limit(AGENT_METRICS_RUN_LIMIT)
      .execute()),
  ]);

  const summaries: AgentRunMetricsSummary[] = models.map((row) => ({
    modelId: row.model_id,
    runs: numberOr(row.runs),
    p50TotalMs: numberOr(row.p50_total_ms),
    p95TotalMs: numberOr(row.p95_total_ms),
    p50FirstTokenMs: nullableNumber(row.p50_first_token_ms),
    p95FirstTokenMs: nullableNumber(row.p95_first_token_ms),
    toolShare: numberOr(row.tool_share),
    failureRate: numberOr(row.failure_rate),
    hangRate: numberOr(row.hang_rate),
  }));
  const recent: AgentRunMetricsRecent[] = runs.filter(row => isAgentRunMetricStatus(row.status)).map(row => ({
    runId: row.run_id,
    modelId: row.model_id,
    status: row.status as AgentRunMetricStatus,
    totalMs: numberOr(row.total_ms),
    firstTokenMs: nullableNumber(row.first_token_ms),
    toolMs: numberOr(row.tool_ms),
    retries: numberOr(row.retries),
    faults: numberOr(row.faults),
    hangs: numberOr(row.hangs),
    endedAt: row.ended_at,
  }));
  return { days, since, models: summaries, runs: recent };
}

/** One run's metrics, including its phase timeline; `null` when the run has none. */
export async function readAgentMetricRunForAdmin(db: ScopedDb, runId: string): Promise<AgentRunMetricsRow | null> {
  const row = await db.tx(trx => trx.selectFrom("agent_run_metrics").selectAll().where("run_id", "=", runId).executeTakeFirst());
  if (!row || !isAgentRunMetricStatus(row.status)) return null;
  return {
    runId: row.run_id,
    modelId: row.model_id,
    status: row.status,
    queuedMs: numberOr(row.queued_ms),
    totalMs: numberOr(row.total_ms),
    firstTokenMs: nullableNumber(row.first_token_ms),
    generationCount: numberOr(row.generation_count),
    generationMs: numberOr(row.generation_ms),
    toolCount: numberOr(row.tool_count),
    toolMs: numberOr(row.tool_ms),
    compactionCount: numberOr(row.compaction_count),
    compactionMs: numberOr(row.compaction_ms),
    retries: numberOr(row.retries),
    faults: numberOr(row.faults),
    hangs: numberOr(row.hangs),
    inputTokens: numberOr(row.input_tokens),
    outputTokens: numberOr(row.output_tokens),
    cacheReadTokens: numberOr(row.cache_read_tokens),
    cacheWriteTokens: numberOr(row.cache_write_tokens),
    totalTokens: numberOr(row.total_tokens),
    phases: Array.isArray(row.phases) ? row.phases as unknown as AgentRunPhase[] : [],
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}
