import 'server-only';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';

/** How long a paused question waits before the model is told the user did not answer. */
export const AGENT_ASK_TIMEOUT_DEFAULT_MINUTES = 5;
/** Rows one sweep handles; the database function caps it too. */
const SWEEP_LIMIT = 100;

export type AwaitingExpirySummary = { nudged: number; cancelled: number; failed: number };

/** `AGENT_ASK_TIMEOUT_MINUTES`: 0 disables the sweep, anything invalid falls back to the default. */
export function agentAskTimeoutMinutes(raw = process.env.AGENT_ASK_TIMEOUT_MINUTES): number {
  if (raw === undefined || raw === '') return AGENT_ASK_TIMEOUT_DEFAULT_MINUTES;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return AGENT_ASK_TIMEOUT_DEFAULT_MINUTES;
  return value;
}

/**
 * Nudges a question nobody answered, then ends the run if the next pause also
 * times out. Runs from the maintenance scheduler in the worker.
 */
export async function expireAwaitingAgentRuns(
  options: { db?: ScopedDb; minutes?: number } = {},
): Promise<AwaitingExpirySummary> {
  const minutes = options.minutes ?? agentAskTimeoutMinutes();
  if (minutes === 0) return { nudged: 0, cancelled: 0, failed: 0 };
  const db = options.db ?? systemDb();
  const result = await db.rpc('agent_expire_awaiting_inputs', {
    p_max_age_minutes: minutes,
    p_limit: SWEEP_LIMIT,
  }) as { nudged?: number; cancelled?: number; failed?: number } | null;
  return {
    nudged: result?.nudged ?? 0,
    cancelled: result?.cancelled ?? 0,
    failed: result?.failed ?? 0,
  };
}
