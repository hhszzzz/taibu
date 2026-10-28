import 'server-only';
import { randomUUID } from 'node:crypto';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { getAgentScheduleLimits, readFeatureModuleStateFresh } from '@/lib/app-settings';
import { getDefaultModelConfigAsync, getModelConfigAsync } from '@/lib/server/ai-config';
import { isModelAllowedForMembership } from '@/lib/ai/ai-access';
import { getUserCreditInfo } from '@/lib/user/credits';
import type { Mention } from '@/types';
import { AgentApiError, submitAgentTask, type AgentSubmitBody } from '../submit.server';
import { expandAgentSchedulePrompt } from './config';
import {
  AgentScheduleError, toAgentScheduleRunView, toAgentScheduleView,
  type AgentScheduleRunRow,
} from './server';

export type AgentScheduleProcessSummary = { claimed: number; submitted: number; skipped: number; failed: number };
type ScheduleView = ReturnType<typeof toAgentScheduleView>;
type RunView = ReturnType<typeof toAgentScheduleRunView>;
type SkipReason = 'insufficient_credits' | 'model_unavailable' | 'feature_disabled' | 'conversation_missing' | 'conversation_busy';

function logFailure(code: string, details: Record<string, unknown> = {}) {
  console.error('[agent-schedules]', { code, ...details });
}

async function loadSchedule(db: ScopedDb, id: string): Promise<ScheduleView | null> {
  const row = await db.tx((trx) => trx.selectFrom('agent_schedules').selectAll().where('id', '=', id).executeTakeFirst());
  return row ? toAgentScheduleView(row) : null;
}

async function settle(
  db: ScopedDb,
  runId: string,
  status: 'running' | 'skipped' | 'failed',
  values: { agentRunId?: string; error?: string; skipReason?: SkipReason } = {},
): Promise<void> {
  await db.rpc('settle_agent_schedule_run', {
    p_run_id: runId,
    p_status: status,
    p_agent_run_id: values.agentRunId ?? null,
    p_error: values.error ?? null,
    p_skip_reason: values.skipReason ?? null,
  });
}

async function knowledgeMentions(db: ScopedDb, userId: string, ids: string[]): Promise<Mention[]> {
  if (!ids.length) return [];
  const rows = await db.tx((trx) => trx.selectFrom('knowledge_bases').select(['id', 'name'])
    .where('user_id', '=', userId).where('id', 'in', ids).execute());
  return rows.map((row) => ({ type: 'knowledge_base' as const, id: row.id, name: row.name, preview: '' }));
}

/** Why this occurrence cannot run now, or null when it can be submitted. */
async function skipReason(db: ScopedDb, schedule: ScheduleView): Promise<{ reason: SkipReason; message: string } | null> {
  const [chat, agent] = await Promise.all([
    readFeatureModuleStateFresh('chat'), readFeatureModuleStateFresh('agent'),
  ]);
  if (chat.status === 'disabled' || agent.status === 'disabled')
    return { reason: 'feature_disabled', message: '功能已关闭，本次运行已跳过。' };
  if (chat.status === 'unavailable' || agent.status === 'unavailable')
    throw new AgentScheduleError('功能状态暂时无法确认', 503, 'FEATURE_STATE_UNAVAILABLE');
  const account = await getUserCreditInfo(schedule.userId, { db });
  if (account.credits <= 0) return { reason: 'insufficient_credits', message: '积分不足，本次运行已跳过。' };
  const config = schedule.options.model
    ? await getModelConfigAsync(schedule.options.model)
    : await getDefaultModelConfigAsync('chat');
  if (!config || !isModelAllowedForMembership(config, account.membership))
    return { reason: 'model_unavailable', message: '模型不可用或当前会员无权限，本次运行已跳过。' };
  return null;
}

function failureOutcome(error: unknown): { kind: 'skipped'; reason: SkipReason } | { kind: 'failed'; message: string } {
  if (error instanceof AgentApiError) {
    if (error.code === 'INSUFFICIENT_CREDITS') return { kind: 'skipped', reason: 'insufficient_credits' };
    if (error.code === 'MEMBERSHIP_REQUIRED' || error.code === 'PROFILE_UNAVAILABLE') return { kind: 'skipped', reason: 'model_unavailable' };
    if (error.code === 'FEATURE_DISABLED') return { kind: 'skipped', reason: 'feature_disabled' };
    if (error.code === 'CONVERSATION_NOT_FOUND') return { kind: 'skipped', reason: 'conversation_missing' };
    if (error.code === 'CONVERSATION_BUSY') return { kind: 'skipped', reason: 'conversation_busy' };
    return { kind: 'failed', message: error.message };
  }
  const message = error instanceof Error ? error.message : '';
  if (message.includes('INSUFFICIENT_CREDITS')) return { kind: 'skipped', reason: 'insufficient_credits' };
  if (message.includes('MEMBERSHIP_REQUIRED') || message.includes('模型不存在')) return { kind: 'skipped', reason: 'model_unavailable' };
  if (message.includes('FEATURE_DISABLED')) return { kind: 'skipped', reason: 'feature_disabled' };
  if (message.includes('AGENT_CONVERSATION_NOT_FOUND') || message.includes('CONVERSATION_NOT_FOUND')) return { kind: 'skipped', reason: 'conversation_missing' };
  if (message.includes('AGENT_CONVERSATION_BUSY') || message.includes('CONVERSATION_BUSY')) return { kind: 'skipped', reason: 'conversation_busy' };
  return { kind: 'failed', message: message || '任务提交失败' };
}

/**
 * Submit one claimed occurrence. The schedule run is marked running with a
 * pre-generated Agent run id before submission, so a completion that the worker
 * reports immediately still finds its schedule run to settle.
 */
async function executeRun(db: ScopedDb, schedule: ScheduleView, run: RunView): Promise<'submitted' | 'skipped' | 'failed'> {
  if (!schedule.conversationId) {
    await settle(db, run.id, 'skipped', { skipReason: 'conversation_missing' });
    return 'skipped';
  }
  try {
    const blocked = await skipReason(db, schedule);
    if (blocked) {
      await settle(db, run.id, 'skipped', { skipReason: blocked.reason, error: blocked.message });
      return 'skipped';
    }
    const content = expandAgentSchedulePrompt(schedule.prompt, {
      scheduledFor: run.scheduledFor, timezone: schedule.timezone, name: schedule.name,
    });
    const chart = schedule.options.baziChartId;
    const message = schedule.template === 'custom' && chart
      ? `${content}\n\n绑定命盘：bazi_chart:${chart}（需要时用 read_user_data 读取）。`
      : content;
    const body: AgentSubmitBody = {
      conversationId: schedule.conversationId,
      clientRequestId: `schedule:${run.id}`,
      message: { id: `schedule:${run.id}`, content: message, attachments: {}, quotes: [] },
      model: schedule.options.model ?? undefined,
      mentions: await knowledgeMentions(db, schedule.userId, schedule.options.knowledgeBaseIds),
      webEnabled: schedule.options.webEnabled,
      codeMode: false,
      planMode: false,
      reasoning: schedule.options.reasoning,
      reasoningEffort: schedule.options.reasoningEffort,
      collaborators: schedule.options.collaborators,
      dreamMode: false,
      mangpaiMode: false,
      timezone: schedule.timezone,
    };
    const agentRunId = randomUUID();
    await settle(db, run.id, 'running', { agentRunId });
    const agentRun = await submitAgentTask({ db, userId: schedule.userId }, body, 'schedule', { runId: agentRunId });
    if (agentRun.id !== agentRunId) await settle(db, run.id, 'running', { agentRunId: agentRun.id });
    return 'submitted';
  } catch (error) {
    const outcome = failureOutcome(error);
    if (outcome.kind === 'skipped') {
      await settle(db, run.id, 'skipped', { skipReason: outcome.reason }).catch(() => logFailure('SCHEDULE_SETTLE_FAILED', { runId: run.id }));
      return 'skipped';
    }
    logFailure('SCHEDULE_SUBMIT_FAILED', { runId: run.id });
    await settle(db, run.id, 'failed', { error: outcome.message }).catch(() => logFailure('SCHEDULE_SETTLE_FAILED', { runId: run.id }));
    return 'failed';
  }
}

/**
 * One scheduler tick: pause anything over the current tier limit, then claim due
 * occurrences and submit them. A failure in one schedule is contained to that run.
 */
export async function processAgentSchedules(options: { limit?: number; db?: ScopedDb } = {}): Promise<AgentScheduleProcessSummary> {
  const db = options.db ?? systemDb();
  const limits = await getAgentScheduleLimits();
  await db.rpc('enforce_agent_schedule_limits', { p_limits: limits });
  const claimed = await db.rpc('claim_agent_schedules', { p_limit: options.limit ?? 20 }) as unknown as AgentScheduleRunRow[];
  const summary: AgentScheduleProcessSummary = { claimed: claimed.length, submitted: 0, skipped: 0, failed: 0 };
  for (const raw of claimed) {
    const run = toAgentScheduleRunView(raw);
    const schedule = await loadSchedule(db, run.scheduleId);
    if (!schedule) {
      await settle(db, run.id, 'failed', { error: '任务已删除' }).catch(() => logFailure('SCHEDULE_SETTLE_FAILED', { runId: run.id }));
      summary.failed += 1;
      continue;
    }
    const outcome = await executeRun(db, schedule, run);
    if (outcome === 'submitted') summary.submitted += 1;
    else if (outcome === 'skipped') summary.skipped += 1;
    else summary.failed += 1;
  }
  return summary;
}

/**
 * 立即运行：a manual occurrence regardless of the schedule being paused. It still
 * checks credits, the model and the feature state, and refuses to stack on a run
 * that has not settled.
 */
export async function runAgentScheduleNow(userId: string, scheduleId: string): Promise<RunView> {
  const db = systemDb();
  const row = await db.tx((trx) => trx.selectFrom('agent_schedules').selectAll()
    .where('id', '=', scheduleId).where('user_id', '=', userId).executeTakeFirst());
  if (!row) throw new AgentScheduleError('定时任务不存在', 404, 'AGENT_SCHEDULE_NOT_FOUND');
  const schedule = toAgentScheduleView(row);
  if (!schedule.conversationId) throw new AgentScheduleError('绑定的对话已删除，请新建任务', 409, 'AGENT_SCHEDULE_CONVERSATION_MISSING');
  const active = await db.tx((trx) => trx.selectFrom('agent_schedule_runs').select('id')
    .where('schedule_id', '=', scheduleId).where('status', 'in', ['pending', 'running']).executeTakeFirst());
  if (active) throw new AgentScheduleError('上一次运行尚未结束', 409, 'AGENT_SCHEDULE_RUN_BUSY');
  const created = await db.tx((trx) => trx.insertInto('agent_schedule_runs')
    .values({ schedule_id: scheduleId, user_id: userId, scheduled_for: new Date().toISOString(), status: 'pending' })
    .returningAll().executeTakeFirstOrThrow());
  const run = toAgentScheduleRunView(created);
  await executeRun(db, schedule, run);
  const settled = await db.tx((trx) => trx.selectFrom('agent_schedule_runs').selectAll().where('id', '=', run.id).executeTakeFirst());
  return settled ? toAgentScheduleRunView(settled) : run;
}
