/**
 * 定时任务运行记录（管理端「日志 → 定时任务」）：每次到点一条，带所属计划、用户、状态、关联的 Agent 任务与它的费用。
 * 纯数据：浏览器与服务端共用。
 */
import type { ReferenceCost } from '@/lib/billing/config';
import type { AgentScheduleCadence, AgentScheduleRunStatus, AgentScheduleTemplate } from './schedules/config';

export const AGENT_SCHEDULE_RUN_STATUSES = ['pending', 'running', 'completed', 'failed', 'skipped'] as const satisfies readonly AgentScheduleRunStatus[];

export type AgentScheduleRunAdminView = {
  id: string;
  scheduleId: string;
  scheduleName: string;
  template: AgentScheduleTemplate;
  /** Null when the stored cadence no longer parses. */
  cadence: AgentScheduleCadence | null;
  timezone: string;
  scheduleEnabled: boolean;
  userId: string;
  /** Absent when the account lookup fails; the list does not depend on it. */
  userEmail: string | null;
  scheduledFor: string;
  status: AgentScheduleRunStatus;
  skipReason: string | null;
  agentRunId: string | null;
  /** The conversation the Agent task ran in. */
  conversationId: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** What the Agent task's model calls cost; null when it made none or the lookup failed. */
  cost: ReferenceCost | null;
};

export type AgentScheduleRunAdminPage = {
  runs: AgentScheduleRunAdminView[];
  nextOffset: number | null;
  /** Runs per status within the account and time filters, whatever the status filter. */
  counts: Record<AgentScheduleRunStatus, number>;
};

/** Times are ISO instants, `to` exclusive; `email` matches addresses by prefix. */
export type AgentScheduleRunAdminFilters = { status?: AgentScheduleRunStatus; email?: string; from?: string; to?: string };

export function parseAgentScheduleRunAdminFilters(params: URLSearchParams): AgentScheduleRunAdminFilters | { error: string } {
  const filters: AgentScheduleRunAdminFilters = {};
  const status = params.get('status');
  if (status) {
    if (!(AGENT_SCHEDULE_RUN_STATUSES as readonly string[]).includes(status)) return { error: '状态无效' };
    filters.status = status as AgentScheduleRunStatus;
  }
  const email = params.get('email')?.trim().toLowerCase();
  if (email) {
    if (email.length > 254) return { error: '邮箱过长' };
    filters.email = email;
  }
  for (const key of ['from', 'to'] as const) {
    const value = params.get(key);
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isNaN(time)) return { error: '时间范围无效' };
    filters[key] = new Date(time).toISOString();
  }
  return filters;
}
