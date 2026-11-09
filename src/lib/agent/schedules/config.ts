/**
 * Scheduled Agent tasks, shared by the sidebar page, the HTTP API and the job
 * scheduler. Pure data and validation: no database, React or server-only imports.
 *
 * A schedule names one fixed conversation and one prompt; each due occurrence
 * appends a normal Agent turn there. The recurrence itself is computed in SQL
 * (agent_next_run_at) so the claim function can advance next_run_at atomically;
 * this module only validates what the user or an administrator wrote.
 */
import type { AIReasoningEffort } from '@/types';
import { parseAgentCollaborators, type AgentCollaborator } from '@/lib/chat/model-settings';

export const AGENT_SCHEDULE_TEMPLATES = ['custom', 'daily_briefing'] as const;
export type AgentScheduleTemplate = (typeof AGENT_SCHEDULE_TEMPLATES)[number];

export const AGENT_SCHEDULE_KINDS = ['daily', 'weekly', 'monthly', 'interval'] as const;
export type AgentScheduleKind = (typeof AGENT_SCHEDULE_KINDS)[number];

export type AgentScheduleCadence =
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; weekdays: number[]; time: string }
  | { kind: 'monthly'; day: number; time: string }
  | { kind: 'interval'; hours: number; time: string };

export type AgentScheduleStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'paused';
export type AgentScheduleRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type AgentScheduleOptions = {
  /** Null: the platform's default chat model at run time. */
  model: string | null;
  reasoning: boolean;
  reasoningEffort: AIReasoningEffort | null;
  webEnabled: boolean;
  /** Knowledge bases whose recent entries join the prompt; empty uses the user's defaults. */
  knowledgeBaseIds: string[];
  /** Bound bazi chart; null follows the user's current default chart. */
  baziChartId: string | null;
  /** Multi-model collaboration members, as the model menu would send them. */
  collaborators: AgentCollaborator[];
  /** Site notification when a run completes or fails; critical skips always notify. */
  notify: boolean;
};

export type AgentScheduleView = {
  id: string;
  userId: string;
  name: string;
  template: AgentScheduleTemplate;
  prompt: string;
  cadence: AgentScheduleCadence;
  timezone: string;
  conversationId: string | null;
  options: AgentScheduleOptions;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: AgentScheduleStatus | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentScheduleRunView = {
  id: string;
  scheduleId: string;
  scheduledFor: string;
  status: AgentScheduleRunStatus;
  skipReason: string | null;
  agentRunId: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type AgentScheduleInput = {
  name: string;
  template: AgentScheduleTemplate;
  prompt: string;
  cadence: AgentScheduleCadence;
  timezone: string;
  options: AgentScheduleOptions;
};

/** How many schedules each user may keep; lowering it pauses everyone's newest beyond it. */
export type AgentScheduleLimits = { limit: number };

export const AGENT_SCHEDULE_LIMITS_KEY = 'agent_schedule_limits';
export const DEFAULT_AGENT_SCHEDULE_LIMITS: AgentScheduleLimits = { limit: 20 };
export const AGENT_SCHEDULE_LIMIT_MAX = 100;
export const AGENT_SCHEDULE_NAME_MAX = 80;
export const AGENT_SCHEDULE_PROMPT_MAX = 4000;
export const AGENT_SCHEDULE_INTERVAL_HOURS_MAX = 24;
export const AGENT_SCHEDULE_KNOWLEDGE_BASES_MAX = 20;
export const AGENT_SCHEDULE_WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AgentScheduleInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'AgentScheduleInputError';
  }
}

export function isAgentScheduleTemplate(value: unknown): value is AgentScheduleTemplate {
  return typeof value === 'string' && (AGENT_SCHEDULE_TEMPLATES as readonly string[]).includes(value);
}

export function validAgentScheduleTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function normalizedTime(value: unknown): string | null {
  return typeof value === 'string' && TIME_PATTERN.test(value) ? value : null;
}

/** The cadence, trimmed to its own fields, or null when anything is out of range. */
export function normalizeAgentScheduleCadence(value: unknown): AgentScheduleCadence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const kind = input.kind;
  const time = normalizedTime(input.time);
  if (typeof kind !== 'string' || !(AGENT_SCHEDULE_KINDS as readonly string[]).includes(kind) || !time) return null;
  if (kind === 'daily') return { kind, time };
  if (kind === 'weekly') {
    if (!Array.isArray(input.weekdays) || input.weekdays.length < 1 || input.weekdays.length > 7) return null;
    const weekdays = [...new Set(input.weekdays)];
    if (weekdays.some(day => !Number.isInteger(day) || (day as number) < 1 || (day as number) > 7)) return null;
    return { kind, weekdays: (weekdays as number[]).sort((a, b) => a - b), time };
  }
  if (kind === 'monthly') {
    if (!Number.isInteger(input.day) || (input.day as number) < 1 || (input.day as number) > 31) return null;
    return { kind, day: input.day as number, time };
  }
  if (!Number.isInteger(input.hours) || (input.hours as number) < 1 || (input.hours as number) > AGENT_SCHEDULE_INTERVAL_HOURS_MAX) return null;
  return { kind: 'interval', hours: input.hours as number, time };
}

export function defaultAgentScheduleOptions(): AgentScheduleOptions {
  return {
    model: null, reasoning: false, reasoningEffort: null, webEnabled: true,
    knowledgeBaseIds: [], baziChartId: null, collaborators: [], notify: true,
  };
}

/** Every field is optional in storage; unknown or malformed values fall back to the default. */
export function normalizeAgentScheduleOptions(value: unknown): AgentScheduleOptions {
  const defaults = defaultAgentScheduleOptions();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const input = value as Record<string, unknown>;
  const model = typeof input.model === 'string' && input.model.trim() && input.model.length <= 200 ? input.model.trim() : null;
  let reasoningEffort: AIReasoningEffort | null = null;
  if (typeof input.reasoningEffort === 'string') {
    try { reasoningEffort = parseAgentReasoningEffort(input.reasoningEffort); } catch { reasoningEffort = null; }
  }
  const knowledgeBaseIds = Array.isArray(input.knowledgeBaseIds)
    ? [...new Set(input.knowledgeBaseIds.filter((item): item is string => typeof item === 'string' && UUID_PATTERN.test(item)))].slice(0, AGENT_SCHEDULE_KNOWLEDGE_BASES_MAX)
    : [];
  let collaborators: AgentCollaborator[] = [];
  if (Array.isArray(input.collaborators)) {
    try { collaborators = parseAgentCollaborators(input.collaborators); } catch { collaborators = []; }
  }
  return {
    model,
    reasoning: input.reasoning === true,
    reasoningEffort,
    webEnabled: input.webEnabled !== false,
    knowledgeBaseIds,
    baziChartId: typeof input.baziChartId === 'string' && UUID_PATTERN.test(input.baziChartId) ? input.baziChartId : null,
    collaborators,
    notify: input.notify !== false,
  };
}

/** Kept local so this module does not pull the whole model-settings surface into every bundle. */
function parseAgentReasoningEffort(value: string): AIReasoningEffort | null {
  const allowed: readonly string[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  return allowed.includes(value) ? value as AIReasoningEffort : null;
}

const INTEGER_LIMIT = /^\d{1,3}$/u;

/** Null when the value is not a limit in range; the SQL reads the same field (agent_schedule_limit). */
export function parseAgentScheduleLimit(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && INTEGER_LIMIT.test(value) ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= AGENT_SCHEDULE_LIMIT_MAX ? parsed : null;
}

export function normalizeAgentScheduleLimits(value: unknown): AgentScheduleLimits {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).limit : undefined;
  return { limit: parseAgentScheduleLimit(raw) ?? DEFAULT_AGENT_SCHEDULE_LIMITS.limit };
}

export function parseAgentScheduleInput(value: unknown): AgentScheduleInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentScheduleInputError('定时任务配置无效');
  const input = value as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > AGENT_SCHEDULE_NAME_MAX) throw new AgentScheduleInputError(`任务名称须为 1–${AGENT_SCHEDULE_NAME_MAX} 个字符`);
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt || prompt.length > AGENT_SCHEDULE_PROMPT_MAX) throw new AgentScheduleInputError(`执行内容须为 1–${AGENT_SCHEDULE_PROMPT_MAX} 个字符`);
  const template = input.template === undefined ? 'custom' : input.template;
  if (!isAgentScheduleTemplate(template)) throw new AgentScheduleInputError('未知的任务模板');
  const cadence = normalizeAgentScheduleCadence(input.cadence);
  if (!cadence) throw new AgentScheduleInputError('执行频率无效');
  if (!validAgentScheduleTimeZone(input.timezone)) throw new AgentScheduleInputError('时区无效');
  return { name, template, prompt, cadence, timezone: input.timezone as string, options: normalizeAgentScheduleOptions(input.options) };
}

export function describeAgentScheduleCadence(cadence: AgentScheduleCadence): string {
  if (cadence.kind === 'daily') return `每天 ${cadence.time}`;
  if (cadence.kind === 'weekly') {
    const days = cadence.weekdays.map(day => AGENT_SCHEDULE_WEEKDAY_LABELS[day - 1]).filter(Boolean).join('、');
    return `每周 ${days} ${cadence.time}`;
  }
  if (cadence.kind === 'monthly') return `每月 ${cadence.day} 日 ${cadence.time}（当月没有这一天时按月末）`;
  return `每 ${cadence.hours} 小时（从 ${cadence.time} 起）`;
}

export const AGENT_SCHEDULE_STATUS_LABELS: Record<AgentScheduleStatus, string> = {
  pending: '等待运行', running: '运行中', completed: '已完成', failed: '未完成', skipped: '已跳过', paused: '已暂停',
};

export const AGENT_SCHEDULE_RUN_STATUS_LABELS: Record<AgentScheduleRunStatus, string> = {
  pending: '等待中', running: '运行中', completed: '已完成', failed: '失败', skipped: '已跳过',
};

export const AGENT_SCHEDULE_SKIP_REASON_LABELS: Record<string, string> = {
  insufficient_balance: '余额不足',
  model_unavailable: '模型不可用',
  feature_disabled: '功能已关闭',
  conversation_missing: '绑定的对话已删除',
  conversation_busy: '对话中有其他任务',
  previous_running: '上一次运行尚未结束',
  missed: '服务中断，错过运行',
};

/** "10-29 08:00" in the schedule's zone; an ISO fallback when the zone is invalid. */
export function formatAgentScheduleMoment(iso: string | null, timezone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date).replaceAll('/', '-');
  } catch {
    return iso;
  }
}

/**
 * The built-in 每日早报 text: what the member wants, not which tools to call. The chart is not named here; it travels
 * with the message as a mention, the bound one or the member's default.
 */
export const DAILY_BRIEFING_PROMPT = '生成今天的运势早报：黄历宜忌、总体提示，以及工作、生活各两到三条具体建议。';
