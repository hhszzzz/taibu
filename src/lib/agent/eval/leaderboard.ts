import type { AgentEvalLeaderboardEntry } from './types';

/** What ranking reads from one stored result. */
export interface AgentEvalLeaderboardResult {
  modelId: string;
  hardPassed: boolean;
  qualityPassed: boolean | null;
  durationMs: number;
  firstTokenMs: number | null;
  totalTokens: number;
}

/** Linear-interpolation percentile, as percentile_cont does in SQL. */
function percentile(sorted: readonly number[], fraction: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * Aggregates one run's results per model. The hard-check rate counts every stored result; the quality rate counts only
 * results the judge scored, so a failed hard check or an unavailable judge neither passes nor fails quality.
 */
export function buildAgentEvalLeaderboard(results: readonly AgentEvalLeaderboardResult[]): AgentEvalLeaderboardEntry[] {
  const byModel = new Map<string, AgentEvalLeaderboardResult[]>();
  for (const result of results) {
    const list = byModel.get(result.modelId) ?? [];
    list.push(result);
    byModel.set(result.modelId, list);
  }
  return [...byModel].map(([modelId, items]) => {
    const durations = items.map(item => item.durationMs).sort((a, b) => a - b);
    const firstTokens = items.flatMap(item => item.firstTokenMs === null ? [] : [item.firstTokenMs]).sort((a, b) => a - b);
    const judged = items.filter(item => item.qualityPassed !== null);
    const qualityPassed = judged.filter(item => item.qualityPassed === true).length;
    const hardPassed = items.filter(item => item.hardPassed).length;
    return {
      modelId,
      results: items.length,
      hardPassed,
      hardPassRate: items.length ? hardPassed / items.length : 0,
      qualityJudged: judged.length,
      qualityPassed,
      qualityPassRate: judged.length ? qualityPassed / judged.length : null,
      meanDurationMs: rounded(mean(durations)) ?? 0,
      p95DurationMs: rounded(percentile(durations, 0.95)) ?? 0,
      meanFirstTokenMs: rounded(mean(firstTokens)),
      p95FirstTokenMs: rounded(percentile(firstTokens, 0.95)),
      meanTokens: rounded(mean(items.map(item => item.totalTokens))) ?? 0,
    };
  }).sort((a, b) => b.hardPassRate - a.hardPassRate
    || (b.qualityPassRate ?? -1) - (a.qualityPassRate ?? -1)
    || a.meanDurationMs - b.meanDurationMs
    || a.modelId.localeCompare(b.modelId));
}
