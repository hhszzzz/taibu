import 'server-only';

import { systemDb } from '@/lib/db/context.server';

const MAX_PASSES = 10;
const BATCH = 1_000;

export type RetentionSummary = {
  events: number;
  commits: number;
  workers: number;
  metrics: number;
  passes: number;
};

/**
 * Deletes terminal Agent history in bounded passes. The SQL function enforces
 * the minimum bounds and the administrator check; this loop only decides when
 * the remaining backlog is small enough to stop.
 */
export async function runAgentRetention(): Promise<RetentionSummary> {
  const requested = Number(process.env.AGENT_EVENT_RETENTION_DAYS ?? '30');
  const eventDays = Number.isSafeInteger(requested) && requested >= 7 ? requested : 30;
  const summary: RetentionSummary = { events: 0, commits: 0, workers: 0, metrics: 0, passes: 0 };
  const db = systemDb();
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const rows = await db.rpc('delete_agent_retention', {
      p_event_days: eventDays,
      p_commit_days: 7,
      p_worker_hours: 24,
      p_limit: BATCH,
      p_metric_days: 30,
    }, { timeoutMs: 30_000 });
    const row = rows[0];
    if (!row) break;
    summary.passes += 1;
    summary.events += Number(row.events_deleted ?? 0);
    summary.commits += Number(row.commits_deleted ?? 0);
    summary.workers += Number(row.workers_deleted ?? 0);
    summary.metrics += Number(row.metrics_deleted ?? 0);
    if (Number(row.events_deleted) < BATCH
      && Number(row.commits_deleted) < BATCH
      && Number(row.workers_deleted) < BATCH
      && Number(row.metrics_deleted) < BATCH) break;
  }
  return summary;
}

export async function runIdentityCleanup(): Promise<{ sessions: number; verifications: number }> {
  const rows = await systemDb().rpc('cleanup_expired_identity_rows', { p_limit: 5_000 });
  const row = rows[0];
  return {
    sessions: Number(row?.sessions_deleted ?? 0),
    verifications: Number(row?.verifications_deleted ?? 0),
  };
}
