import 'server-only';

import { systemDb } from '@/lib/db/context.server';
import type { ReferenceCost } from '@/lib/billing/config';
import { emailsOf, referenceCosts } from '@/lib/billing/ledger.server';
import { isAgentScheduleTemplate, normalizeAgentScheduleCadence, type AgentScheduleRunStatus } from './schedules/config';
import {
  AGENT_SCHEDULE_RUN_STATUSES, type AgentScheduleRunAdminFilters, type AgentScheduleRunAdminPage, type AgentScheduleRunAdminView,
} from './admin-schedule-runs';

type Page = { limit?: number; offset?: number };

const emptyCounts = () => Object.fromEntries(AGENT_SCHEDULE_RUN_STATUSES.map(status => [status, 0])) as Record<AgentScheduleRunStatus, number>;

/**
 * Every member's schedule runs, newest first, with the schedule each belongs to, the account, the Agent task's
 * conversation and what its model calls cost, plus the runs per status within the account and time filters.
 */
export async function listAgentScheduleRunsForAdmin(filters: AgentScheduleRunAdminFilters, page?: Page): Promise<AgentScheduleRunAdminPage> {
  const db = systemDb();
  const limit = Math.min(Math.max(Math.trunc(page?.limit ?? 50), 1), 100);
  const offset = Math.max(Math.trunc(page?.offset ?? 0), 0);
  let userIds: string[] | undefined;
  if (filters.email) {
    userIds = (await db.rpc('admin_find_users_by_email', { p_query: filters.email, p_limit: 50 })).map(row => row.user_id);
    if (!userIds.length) return { runs: [], nextOffset: null, counts: emptyCounts() };
  }
  const [rows, counted] = await Promise.all([
    db.tx((trx) => trx.selectFrom('agent_schedule_runs')
      .innerJoin('agent_schedules', 'agent_schedules.id', 'agent_schedule_runs.schedule_id')
      .leftJoin('agent_runs', 'agent_runs.id', 'agent_schedule_runs.agent_run_id')
      .select([
        'agent_schedule_runs.id', 'agent_schedule_runs.schedule_id', 'agent_schedule_runs.user_id', 'agent_schedule_runs.scheduled_for',
        'agent_schedule_runs.status', 'agent_schedule_runs.skip_reason', 'agent_schedule_runs.agent_run_id', 'agent_schedule_runs.error',
        'agent_schedule_runs.created_at', 'agent_schedule_runs.started_at', 'agent_schedule_runs.finished_at',
        'agent_schedules.name', 'agent_schedules.template', 'agent_schedules.cadence', 'agent_schedules.timezone', 'agent_schedules.enabled',
        'agent_runs.conversation_id',
      ])
      .where((eb) => eb.and([
        ...(userIds ? [eb('agent_schedule_runs.user_id', 'in', userIds)] : []),
        ...(filters.status ? [eb('agent_schedule_runs.status', '=', filters.status)] : []),
        ...(filters.from ? [eb('agent_schedule_runs.created_at', '>=', filters.from)] : []),
        ...(filters.to ? [eb('agent_schedule_runs.created_at', '<', filters.to)] : []),
      ]))
      .orderBy('agent_schedule_runs.created_at', 'desc').orderBy('agent_schedule_runs.id', 'desc')
      .offset(offset).limit(limit + 1).execute()),
    db.tx((trx) => trx.selectFrom('agent_schedule_runs')
      .select((eb) => ['status', eb.fn.countAll<string>().as('count')])
      .where((eb) => eb.and([
        ...(userIds ? [eb('user_id', 'in', userIds)] : []),
        ...(filters.from ? [eb('created_at', '>=', filters.from)] : []),
        ...(filters.to ? [eb('created_at', '<', filters.to)] : []),
      ]))
      .groupBy('status').execute()),
  ]);
  const shown = rows.slice(0, limit);
  const runIds = shown.flatMap(row => (row.agent_run_id ? [row.agent_run_id] : []));
  const [emails, costs] = await Promise.all([
    emailsOf(shown.map(row => row.user_id)),
    referenceCosts('agent_run', runIds, db).catch(() => new Map<string, ReferenceCost>()),
  ]);
  const counts = emptyCounts();
  for (const row of counted) if (row.status in counts) counts[row.status as AgentScheduleRunStatus] = Number(row.count);
  return {
    runs: shown.map((row): AgentScheduleRunAdminView => ({
      id: row.id, scheduleId: row.schedule_id, scheduleName: row.name,
      template: isAgentScheduleTemplate(row.template) ? row.template : 'custom',
      cadence: normalizeAgentScheduleCadence(row.cadence), timezone: row.timezone, scheduleEnabled: row.enabled,
      userId: row.user_id, userEmail: emails.get(row.user_id) ?? null,
      scheduledFor: row.scheduled_for, status: row.status as AgentScheduleRunStatus, skipReason: row.skip_reason,
      agentRunId: row.agent_run_id, conversationId: row.conversation_id, error: row.error,
      createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
      cost: (row.agent_run_id ? costs.get(row.agent_run_id) : undefined) ?? null,
    })),
    nextOffset: rows.length > limit ? offset + limit : null,
    counts,
  };
}
