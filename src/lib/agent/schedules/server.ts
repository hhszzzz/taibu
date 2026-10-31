import 'server-only';
import type { ScopedDb } from '@/lib/db/context.server';
import { getAgentScheduleLimits } from '@/lib/app-settings';
import {
  normalizeAgentScheduleCadence, normalizeAgentScheduleOptions,
  type AgentScheduleInput, type AgentScheduleRunView, type AgentScheduleRunStatus, type AgentScheduleStatus,
  type AgentScheduleTemplate, type AgentScheduleView,
} from './config';
import type { AgentScheduleAllowance } from './client';

/** The columns these modules read; declared here so the architecture guard keeps SQL types inside src/lib/db. */
export type AgentScheduleRow = {
  id: string;
  user_id: string;
  name: string;
  template: string;
  prompt: string;
  cadence: unknown;
  timezone: string;
  conversation_id: string | null;
  options: unknown;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
};

export type AgentScheduleRunRow = {
  id: string;
  schedule_id: string;
  user_id: string;
  scheduled_for: string;
  status: string;
  skip_reason: string | null;
  agent_run_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export class AgentScheduleError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'AGENT_SCHEDULE_INVALID') {
    super(message);
  }
}

export function toAgentScheduleView(row: AgentScheduleRow): AgentScheduleView {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    template: row.template as AgentScheduleTemplate,
    prompt: row.prompt,
    cadence: normalizeAgentScheduleCadence(row.cadence) ?? { kind: 'daily', time: '08:00' },
    timezone: row.timezone,
    conversationId: row.conversation_id,
    options: normalizeAgentScheduleOptions(row.options),
    enabled: row.enabled,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastStatus: (row.last_status as AgentScheduleStatus | null) ?? null,
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAgentScheduleRunView(row: AgentScheduleRunRow): AgentScheduleRunView {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    scheduledFor: row.scheduled_for,
    status: row.status as AgentScheduleRunStatus,
    skipReason: row.skip_reason,
    agentRunId: row.agent_run_id,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export async function listAgentSchedules(db: ScopedDb, userId: string): Promise<AgentScheduleView[]> {
  const rows = await db.tx((trx) => trx.selectFrom('agent_schedules').selectAll()
    .where('user_id', '=', userId).orderBy('created_at', 'desc').execute());
  return rows.map(toAgentScheduleView);
}

/** How many schedules the user may keep and how many they have; used to gate creation. */
export async function agentScheduleAllowance(db: ScopedDb, userId: string): Promise<AgentScheduleAllowance> {
  const [limits, rows] = await Promise.all([
    getAgentScheduleLimits(),
    db.tx((trx) => trx.selectFrom('agent_schedules').select(({ fn }) => fn.countAll<string>().as('count'))
      .where('user_id', '=', userId).executeTakeFirst()),
  ]);
  return { limit: limits.limit, used: Number(rows?.count ?? 0) };
}

function failure(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('AGENT_SCHEDULE_LIMIT')) throw new AgentScheduleError('定时任务数量已达上限', 409, 'AGENT_SCHEDULE_LIMIT');
  if (message.includes('AGENT_SCHEDULE_NOT_FOUND')) throw new AgentScheduleError('定时任务不存在', 404, 'AGENT_SCHEDULE_NOT_FOUND');
  if (message.includes('AGENT_SCHEDULE_CONVERSATION_MISSING')) throw new AgentScheduleError('绑定的对话已删除，请新建任务', 409, 'AGENT_SCHEDULE_CONVERSATION_MISSING');
  if (message.includes('AGENT_SCHEDULE_RUN_BUSY')) throw new AgentScheduleError('上一次运行尚未结束', 409, 'AGENT_SCHEDULE_RUN_BUSY');
  if (message.includes('AGENT_SCHEDULE_NAME_INVALID')) throw new AgentScheduleError('任务名称无效', 400);
  if (message.includes('AGENT_SCHEDULE_PROMPT_INVALID')) throw new AgentScheduleError('执行内容无效', 400);
  if (message.includes('AGENT_SCHEDULE_CADENCE_INVALID') || message.includes('AGENT_SCHEDULE_TIME_INVALID')) throw new AgentScheduleError('执行频率无效', 400);
  if (message.includes('AGENT_SCHEDULE_TIMEZONE_INVALID')) throw new AgentScheduleError('时区无效', 400);
  if (message.includes('AGENT_SCHEDULE_TEMPLATE_INVALID')) throw new AgentScheduleError('未知的任务模板', 400);
  console.error('[agent-schedules]', { code: 'AGENT_SCHEDULE_FAILED' });
  throw new AgentScheduleError('定时任务服务暂时不可用', 500, 'AGENT_SCHEDULE_FAILED');
}

export async function createAgentSchedule(db: ScopedDb, userId: string, input: AgentScheduleInput): Promise<AgentScheduleView> {
  const allowance = await agentScheduleAllowance(db, userId);
  if (allowance.limit <= 0) throw new AgentScheduleError('管理员已关闭定时任务创建', 403, 'AGENT_SCHEDULE_DISABLED');
  if (allowance.used >= allowance.limit) throw new AgentScheduleError(`每人最多创建 ${allowance.limit} 个定时任务`, 409, 'AGENT_SCHEDULE_LIMIT');
  try {
    const row = await db.rpc('create_agent_schedule', {
      p_name: input.name, p_template: input.template, p_prompt: input.prompt,
      // The quota is the function's own business: it reads the admin setting itself.
      p_cadence: input.cadence, p_timezone: input.timezone, p_options: input.options,
    });
    return toAgentScheduleView(row as unknown as AgentScheduleRow);
  } catch (error) {
    return failure(error);
  }
}

export async function updateAgentSchedule(
  db: ScopedDb,
  id: string,
  current: { name: string; prompt: string; cadence: AgentScheduleInput['cadence']; timezone: string; options: AgentScheduleInput['options']; enabled: boolean },
  patch: Partial<AgentScheduleInput> & { enabled?: boolean },
): Promise<AgentScheduleView> {
  const merged = {
    name: patch.name ?? current.name,
    prompt: patch.prompt ?? current.prompt,
    cadence: patch.cadence ?? current.cadence,
    timezone: patch.timezone ?? current.timezone,
    options: patch.options ?? current.options,
    enabled: patch.enabled ?? current.enabled,
  };
  try {
    const row = await db.rpc('update_agent_schedule', {
      p_id: id, p_name: merged.name, p_prompt: merged.prompt, p_cadence: merged.cadence,
      p_timezone: merged.timezone, p_options: merged.options, p_enabled: merged.enabled,
    });
    return toAgentScheduleView(row as unknown as AgentScheduleRow);
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAgentSchedule(db: ScopedDb, userId: string, id: string): Promise<boolean> {
  const rows = await db.tx((trx) => trx.deleteFrom('agent_schedules')
    .where('id', '=', id).where('user_id', '=', userId).returning('id').execute());
  return rows.length > 0;
}

export async function getAgentScheduleRow(db: ScopedDb, userId: string, id: string) {
  return db.tx((trx) => trx.selectFrom('agent_schedules').selectAll()
    .where('id', '=', id).where('user_id', '=', userId).executeTakeFirst());
}

export async function listAgentScheduleRuns(db: ScopedDb, userId: string, scheduleId: string, limit = 30): Promise<AgentScheduleRunView[]> {
  const rows = await db.tx((trx) => trx.selectFrom('agent_schedule_runs').selectAll()
    .where('schedule_id', '=', scheduleId).where('user_id', '=', userId)
    .orderBy('scheduled_for', 'desc').limit(Math.min(Math.max(limit, 1), 100)).execute());
  return rows.map(toAgentScheduleRunView);
}
