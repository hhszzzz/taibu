import 'server-only';
import type { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser, requireUserContext } from '@/lib/api-utils';
import { getAgentScheduleLimits, readFeatureModuleStateFresh, setAgentScheduleLimits } from '@/lib/app-settings';
import { isValidUUID } from '@/lib/validation';
import {
  AGENT_SCHEDULE_LIMIT_MAX, AgentScheduleInputError, parseAgentScheduleInput, parseAgentScheduleLimit,
  type AgentScheduleLimits,
} from './config';
import {
  AgentScheduleError, agentScheduleAllowance, createAgentSchedule, deleteAgentSchedule, getAgentScheduleRow,
  listAgentScheduleRuns, listAgentSchedules, updateAgentSchedule,
} from './server';
import { runAgentScheduleNow } from './runner.server';

/** Feature switch for this area; fail closed when the state cannot be read. */
async function schedulesGate(): Promise<Response | null> {
  const state = await readFeatureModuleStateFresh('schedules');
  if (state.status === 'enabled') return null;
  if (state.status === 'unavailable') return jsonError('功能状态暂时无法确认，请稍后重试', 503, { code: 'FEATURE_STATE_UNAVAILABLE' });
  return jsonError('定时任务功能当前未启用', 403, { code: 'FEATURE_DISABLED' });
}

const readBody = (request: NextRequest) => request.json().catch(() => null) as Promise<unknown>;

function failure(error: unknown): Response {
  if (error instanceof AgentScheduleInputError) return jsonError(error.message, 400, { code: 'AGENT_SCHEDULE_INVALID' });
  if (error instanceof AgentScheduleError) return jsonError(error.message, error.status, { code: error.code });
  console.error('[agent-schedules-api]', { code: 'AGENT_SCHEDULE_FAILED' });
  return jsonError('定时任务服务暂时不可用', 500, { code: 'AGENT_SCHEDULE_FAILED' });
}

async function member(request: NextRequest) {
  const auth = await requireUserContext(request);
  if ('error' in auth) return { response: jsonError(auth.error.message, auth.error.status) } as const;
  const expected = request.headers.get('X-Expected-User-Id');
  if (expected !== null && expected !== auth.user.id) return { response: jsonError('账号已切换', 409) } as const;
  return { auth } as const;
}

export async function readSchedules(request: NextRequest) {
  const gate = await schedulesGate();
  if (gate) return gate;
  const context = await member(request);
  if ('response' in context) return context.response;
  try {
    const [schedules, allowance] = await Promise.all([
      listAgentSchedules(context.auth.db, context.auth.user.id),
      agentScheduleAllowance(context.auth.db, context.auth.user.id),
    ]);
    return jsonOk({ schedules, allowance });
  } catch (error) {
    return failure(error);
  }
}

export async function createSchedule(request: NextRequest) {
  const gate = await schedulesGate();
  if (gate) return gate;
  const context = await member(request);
  if ('response' in context) return context.response;
  try {
    const input = parseAgentScheduleInput(await readBody(request));
    const schedule = await createAgentSchedule(context.auth.db, context.auth.user.id, input);
    return jsonOk({ schedule, allowance: await agentScheduleAllowance(context.auth.db, context.auth.user.id) }, 201);
  } catch (error) {
    return failure(error);
  }
}

export async function updateSchedule(request: NextRequest, id: string) {
  const gate = await schedulesGate();
  if (gate) return gate;
  if (!isValidUUID(id)) return jsonError('定时任务标识无效', 400);
  const context = await member(request);
  if ('response' in context) return context.response;
  try {
    const row = await getAgentScheduleRow(context.auth.db, context.auth.user.id, id);
    if (!row) return jsonError('定时任务不存在', 404, { code: 'AGENT_SCHEDULE_NOT_FOUND' });
    const body = await readBody(request) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('定时任务配置无效', 400);
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return jsonError('启停状态无效', 400);
    const current = {
      name: row.name, prompt: row.prompt, template: row.template, cadence: row.cadence,
      timezone: row.timezone, options: row.options, enabled: row.enabled,
    };
    const merged = {
      name: typeof body.name === 'string' ? body.name : current.name,
      template: body.template ?? current.template,
      prompt: typeof body.prompt === 'string' ? body.prompt : current.prompt,
      cadence: body.cadence ?? current.cadence,
      timezone: typeof body.timezone === 'string' ? body.timezone : current.timezone,
      options: body.options ?? current.options,
    };
    const input = parseAgentScheduleInput(merged);
    const schedule = await updateAgentSchedule(context.auth.db, id, {
      name: current.name, prompt: current.prompt, cadence: input.cadence, timezone: input.timezone,
      options: input.options, enabled: current.enabled,
    }, { ...input, enabled: body.enabled as boolean | undefined });
    return jsonOk({ schedule, allowance: await agentScheduleAllowance(context.auth.db, context.auth.user.id) });
  } catch (error) {
    return failure(error);
  }
}

export async function removeSchedule(request: NextRequest, id: string) {
  const gate = await schedulesGate();
  if (gate) return gate;
  if (!isValidUUID(id)) return jsonError('定时任务标识无效', 400);
  const context = await member(request);
  if ('response' in context) return context.response;
  try {
    if (!(await deleteAgentSchedule(context.auth.db, context.auth.user.id, id))) return jsonError('定时任务不存在', 404);
    return jsonOk({ deleted: true, allowance: await agentScheduleAllowance(context.auth.db, context.auth.user.id) });
  } catch (error) {
    return failure(error);
  }
}

export async function runScheduleNow(request: NextRequest, id: string) {
  const gate = await schedulesGate();
  if (gate) return gate;
  if (!isValidUUID(id)) return jsonError('定时任务标识无效', 400);
  const context = await member(request);
  if ('response' in context) return context.response;
  try {
    return jsonOk({ run: await runAgentScheduleNow(context.auth.user.id, id) });
  } catch (error) {
    return failure(error);
  }
}

export async function readScheduleRuns(request: NextRequest, id: string) {
  const gate = await schedulesGate();
  if (gate) return gate;
  if (!isValidUUID(id)) return jsonError('定时任务标识无效', 400);
  const context = await member(request);
  if ('response' in context) return context.response;
  try {
    if (!(await getAgentScheduleRow(context.auth.db, context.auth.user.id, id))) return jsonError('定时任务不存在', 404);
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 30);
    return jsonOk({ runs: await listAgentScheduleRuns(context.auth.db, context.auth.user.id, id, Number.isFinite(limit) ? limit : 30) });
  } catch (error) {
    return failure(error);
  }
}

export async function readScheduleLimits(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  try {
    return jsonOk({ limits: await getAgentScheduleLimits() });
  } catch (error) {
    return failure(error);
  }
}

export async function saveScheduleLimits(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  try {
    const body = await readBody(request) as { limits?: unknown } | null;
    if (!body || typeof body !== 'object' || !body.limits || typeof body.limits !== 'object' || Array.isArray(body.limits))
      return jsonError('额度无效', 400);
    const limit = parseAgentScheduleLimit((body.limits as Record<string, unknown>).limit);
    if (limit === null) return jsonError(`每人的定时任务上限须为 0–${AGENT_SCHEDULE_LIMIT_MAX} 的整数`, 400);
    const limits: AgentScheduleLimits = { limit };
    await setAgentScheduleLimits(limits);
    return jsonOk({ limits });
  } catch (error) {
    return failure(error);
  }
}
