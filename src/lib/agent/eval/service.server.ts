import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ScopedDb } from '@/lib/db/context.server';
import { json } from '@/lib/db/sql-helpers';
import { getModelConfigAsync, getModelsByUsageTypeAsync } from '@/lib/server/ai-config';
import { getAgentEvalQueue } from '@/lib/jobs/queues.server';
import { BUILTIN_AGENT_EVAL_CASES } from './builtin-cases';
import { buildAgentEvalLeaderboard } from './leaderboard';
import {
  AGENT_EVAL_CALL_LIMIT, AGENT_EVAL_REPEAT_LIMIT,
  type AgentEvalCase, type AgentEvalLeaderboardEntry, type AgentEvalModelOption, type AgentEvalOverview,
  type AgentEvalResultView, type AgentEvalRunResults, type AgentEvalRunStatus, type AgentEvalRunView,
  type AgentEvalToolCall,
} from './types';

/** Newest runs the admin page lists; older runs stay in the database. */
export const AGENT_EVAL_RUN_LIMIT = 20;
const CASE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

export class AgentEvalInputError extends Error {}

const nowIso = () => new Date().toISOString();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toolTrace(value: unknown): AgentEvalToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const call = record(item);
    if (!call || typeof call.name !== 'string' || (call.status !== 'ok' && call.status !== 'error')) return [];
    return [{
      name: call.name,
      ...(call.arguments === undefined ? {} : { arguments: call.arguments }),
      status: call.status,
      ...(typeof call.durationMs === 'number' ? { durationMs: call.durationMs } : {}),
      ...(typeof call.error === 'string' ? { error: call.error } : {}),
    }];
  });
}

export function agentEvalCaseFromRow(row: Record<string, unknown>): AgentEvalCase {
  const chart = record(row.chart);
  return {
    id: String(row.id),
    tool: String(row.tool),
    guide: String(row.guide),
    prompt: String(row.prompt),
    assertions: stringList(row.assertions),
    arguments: record(row.arguments) ?? {},
    ...(chart && typeof chart.tool === 'string' ? { chart: { tool: chart.tool, arguments: record(chart.arguments) ?? {} } } : {}),
    ...(row.visual === true ? { visual: true } : {}),
    builtin: row.builtin === true,
    enabled: row.is_enabled !== false,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function runStatus(value: unknown): AgentEvalRunStatus {
  return value === 'running' || value === 'completed' || value === 'failed' || value === 'cancelled' ? value : 'queued';
}

function runFromRow(row: Record<string, unknown>): AgentEvalRunView {
  return {
    id: String(row.id),
    createdBy: String(row.created_by),
    models: stringList(row.models),
    judgeModel: String(row.judge_model),
    caseIds: stringList(row.case_ids),
    repeats: Number(row.repeats ?? 1),
    totalCalls: Number(row.total_calls ?? 0),
    completedCalls: Number(row.completed_calls ?? 0),
    status: runStatus(row.status),
    cancelRequested: row.cancel_requested === true,
    error: typeof row.error === 'string' ? row.error : null,
    startedAt: typeof row.started_at === 'string' ? row.started_at : row.started_at instanceof Date ? row.started_at.toISOString() : null,
    endedAt: typeof row.ended_at === 'string' ? row.ended_at : row.ended_at instanceof Date ? row.ended_at.toISOString() : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at instanceof Date ? row.created_at.toISOString() : '',
  };
}

function resultFromRow(row: Record<string, unknown>): AgentEvalResultView {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    modelId: String(row.model_id),
    repeat: Number(row.repeat ?? 1),
    hardPassed: row.hard_passed === true,
    qualityPassed: typeof row.quality_passed === 'boolean' ? row.quality_passed : null,
    failedAssertions: stringList(row.failed_assertions),
    answer: typeof row.answer === 'string' ? row.answer : '',
    judgeResponse: typeof row.judge_response === 'string' ? row.judge_response : null,
    toolTrace: toolTrace(row.tool_trace),
    toolCalls: Number(row.tool_calls ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    firstTokenMs: row.first_token_ms === null || row.first_token_ms === undefined ? null : Number(row.first_token_ms),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    error: typeof row.error === 'string' ? row.error : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at instanceof Date ? row.created_at.toISOString() : '',
  };
}

/** Built-in cases are inserted once; an administrator's edits are never overwritten. */
export async function syncBuiltinEvalCases(db: ScopedDb) {
  if (!BUILTIN_AGENT_EVAL_CASES.length) return;
  await db.tx(trx => trx.insertInto('agent_eval_cases')
    .values(BUILTIN_AGENT_EVAL_CASES.map(item => ({
      id: item.id,
      tool: item.tool,
      guide: item.guide,
      prompt: item.prompt,
      assertions: json(item.assertions) as never,
      arguments: json(item.arguments) as never,
      chart: item.chart ? json(item.chart) as never : null,
      visual: item.visual === true,
      builtin: true,
      is_enabled: true,
      sort_order: item.sortOrder ?? 0,
    })))
    .onConflict(oc => oc.column('id').doNothing())
    .execute());
}

export async function listAgentEvalCases(db: ScopedDb): Promise<AgentEvalCase[]> {
  await syncBuiltinEvalCases(db);
  const rows = await db.tx(trx => trx.selectFrom('agent_eval_cases')
    .selectAll()
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .execute());
  return rows.map(row => agentEvalCaseFromRow(row as unknown as Record<string, unknown>));
}

/** Cases in the order an evaluation names them; ids that no longer exist are omitted. */
export async function readAgentEvalCases(db: ScopedDb, ids: string[]): Promise<AgentEvalCase[]> {
  if (!ids.length) return [];
  const rows = await db.tx(trx => trx.selectFrom('agent_eval_cases')
    .selectAll()
    .where('id', 'in', ids)
    .execute());
  const byId = new Map(rows.map(row => [row.id, agentEvalCaseFromRow(row as unknown as Record<string, unknown>)]));
  return ids.flatMap(id => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export interface AgentEvalCaseFields {
  id: string;
  tool: string;
  guide: string;
  prompt: string;
  assertions: string[];
  arguments: Record<string, unknown>;
  chart: { tool: string; arguments: Record<string, unknown> } | null;
  visual: boolean;
  enabled: boolean;
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AgentEvalInputError(`${label}须为 1–${max} 个字符`);
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, label, max);
}

function caseAssertions(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new AgentEvalInputError('断言须为 1–20 条');
  return value.map(item => {
    if (typeof item !== 'string' || !item.trim() || item.length > 1000) throw new AgentEvalInputError('每条断言须为 1–1000 个字符');
    return item;
  });
}

function caseChart(value: unknown): { tool: string; arguments: Record<string, unknown> } | null {
  if (value === null || value === undefined) return null;
  const chart = record(value);
  if (!chart) throw new AgentEvalInputError('先排盘的配置无效');
  return { tool: requiredText(chart.tool, '先排盘的工具', 64), arguments: record(chart.arguments) ?? {} };
}

function caseArguments(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  const args = record(value);
  if (!args) throw new AgentEvalInputError('工具参数须为 JSON 对象');
  if (JSON.stringify(args).length > 20000) throw new AgentEvalInputError('工具参数过大');
  return args;
}

function caseId(value: unknown): string {
  if (typeof value !== 'string' || !CASE_ID_PATTERN.test(value)) throw new AgentEvalInputError('题目标识只能用小写字母、数字、下划线和连字符');
  return value;
}

/** A whole case from the editor; `id` may be omitted for a new one. */
export function parseEvalCaseInput(body: unknown, { requireId }: { requireId: boolean }): AgentEvalCaseFields {
  const input = record(body);
  if (!input) throw new AgentEvalInputError('请求内容无效');
  const id = requireId ? caseId(input.id) : input.id === undefined ? randomUUID() : caseId(input.id);
  const chart = caseChart(input.chart);
  const args = caseArguments(input.arguments);
  return {
    id,
    tool: requiredText(input.tool, '工具', 64),
    guide: requiredText(input.guide, '体系', 64),
    prompt: requiredText(input.prompt, '题目', 8000),
    assertions: caseAssertions(input.assertions),
    arguments: args,
    chart,
    visual: input.visual === true,
    enabled: input.enabled !== false,
  };
}

/** PATCH merges the fields that are present; every present field is validated as in a full input. */
export function parseEvalCaseUpdate(body: unknown): Partial<Omit<AgentEvalCaseFields, 'id'>> {
  const input = record(body);
  if (!input) throw new AgentEvalInputError('请求内容无效');
  const update: Partial<Omit<AgentEvalCaseFields, 'id'>> = {};
  const tool = optionalText(input.tool, '工具', 64);
  if (tool !== undefined) update.tool = tool;
  const guide = optionalText(input.guide, '体系', 64);
  if (guide !== undefined) update.guide = guide;
  const prompt = optionalText(input.prompt, '题目', 8000);
  if (prompt !== undefined) update.prompt = prompt;
  if (input.assertions !== undefined) update.assertions = caseAssertions(input.assertions);
  if (input.arguments !== undefined) update.arguments = caseArguments(input.arguments);
  if (input.chart !== undefined) update.chart = caseChart(input.chart);
  if (input.visual !== undefined) update.visual = input.visual === true;
  if (input.enabled !== undefined) update.enabled = input.enabled !== false;
  if (!Object.keys(update).length) throw new AgentEvalInputError('没有要保存的修改');
  return update;
}

function caseValues(fields: Partial<AgentEvalCaseFields>) {
  return {
    ...(fields.tool === undefined ? {} : { tool: fields.tool }),
    ...(fields.guide === undefined ? {} : { guide: fields.guide }),
    ...(fields.prompt === undefined ? {} : { prompt: fields.prompt }),
    ...(fields.assertions === undefined ? {} : { assertions: json(fields.assertions) as never }),
    ...(fields.arguments === undefined ? {} : { arguments: json(fields.arguments) as never }),
    ...(fields.chart === undefined ? {} : { chart: fields.chart ? json(fields.chart) as never : null }),
    ...(fields.visual === undefined ? {} : { visual: fields.visual }),
    ...(fields.enabled === undefined ? {} : { is_enabled: fields.enabled }),
  };
}

export async function createAgentEvalCase(db: ScopedDb, fields: AgentEvalCaseFields): Promise<AgentEvalCase> {
  await syncBuiltinEvalCases(db);
  const existing = await db.tx(trx => trx.selectFrom('agent_eval_cases').select('id').where('id', '=', fields.id).executeTakeFirst());
  if (existing) throw new AgentEvalInputError('已有同标识的题目，请换一个');
  const maxOrder = await db.tx(trx => trx.selectFrom('agent_eval_cases').select(trx.fn.max('sort_order').as('max')).executeTakeFirst());
  const row = await db.tx(trx => trx.insertInto('agent_eval_cases').values({
    id: fields.id,
    tool: fields.tool,
    guide: fields.guide,
    prompt: fields.prompt,
    assertions: json(fields.assertions) as never,
    arguments: json(fields.arguments) as never,
    chart: fields.chart ? json(fields.chart) as never : null,
    visual: fields.visual,
    builtin: false,
    is_enabled: fields.enabled,
    sort_order: Number(maxOrder?.max ?? 0) + 1,
  }).returningAll().executeTakeFirstOrThrow());
  return agentEvalCaseFromRow(row as unknown as Record<string, unknown>);
}

export async function updateAgentEvalCase(db: ScopedDb, id: string, update: Partial<Omit<AgentEvalCaseFields, 'id'>>): Promise<AgentEvalCase | null> {
  const row = await db.tx(trx => trx.updateTable('agent_eval_cases')
    .set({ ...caseValues(update) as Record<string, never>, updated_at: nowIso() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst());
  return row ? agentEvalCaseFromRow(row as unknown as Record<string, unknown>) : null;
}

/** Built-in cases stay: they are imported again and can be switched off instead. */
export async function deleteAgentEvalCase(db: ScopedDb, id: string): Promise<boolean | null> {
  const row = await db.tx(trx => trx.selectFrom('agent_eval_cases').select(['id', 'builtin']).where('id', '=', id).executeTakeFirst());
  if (!row) return null;
  if (row.builtin) throw new AgentEvalInputError('内置题不能删除，可以停用');
  await db.tx(trx => trx.deleteFrom('agent_eval_cases').where('id', '=', id).execute());
  return true;
}

export interface AgentEvalLaunchInput {
  models: string[];
  judgeModel: string;
  caseIds: string[];
  repeats: number;
}

function uniqueStrings(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || !value.length) throw new AgentEvalInputError(`请选择${label}`);
  const items = value.map(item => requiredText(item, label, 200));
  const unique = [...new Set(items)];
  if (unique.length !== items.length) throw new AgentEvalInputError(`${label}不能重复`);
  if (unique.length > max) throw new AgentEvalInputError(`${label}最多 ${max} 个`);
  return unique;
}

export function parseAgentEvalLaunch(body: unknown): AgentEvalLaunchInput {
  const input = record(body);
  if (!input) throw new AgentEvalInputError('请求内容无效');
  const models = uniqueStrings(input.models, '模型', 10);
  const caseIds = uniqueStrings(input.caseIds, '题目', 100);
  const judgeModel = requiredText(input.judgeModel, '评审模型', 200);
  const repeats = Number(input.repeats ?? 1);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > AGENT_EVAL_REPEAT_LIMIT)
    throw new AgentEvalInputError(`重复次数须为 1–${AGENT_EVAL_REPEAT_LIMIT}`);
  if (models.length * caseIds.length * repeats > AGENT_EVAL_CALL_LIMIT)
    throw new AgentEvalInputError(`题目 × 模型 × 重复次数不能超过 ${AGENT_EVAL_CALL_LIMIT}`);
  return { models, judgeModel, caseIds, repeats };
}

export async function launchAgentEval(db: ScopedDb, createdBy: string, input: AgentEvalLaunchInput): Promise<AgentEvalRunView> {
  await syncBuiltinEvalCases(db);
  const configs = await Promise.all([...input.models, input.judgeModel].map(model => getModelConfigAsync(model)));
  if (configs.some(config => !config)) throw new AgentEvalInputError('所选模型不存在或已停用');
  const cases = await db.tx(trx => trx.selectFrom('agent_eval_cases')
    .select(['id', 'is_enabled'])
    .where('id', 'in', input.caseIds)
    .execute());
  const enabled = new Set(cases.filter(row => row.is_enabled).map(row => row.id));
  if (input.caseIds.some(id => !enabled.has(id))) throw new AgentEvalInputError('所选题目不存在或已停用');
  const totalCalls = input.models.length * input.caseIds.length * input.repeats;
  const row = await db.tx(trx => trx.insertInto('agent_eval_runs').values({
    created_by: createdBy,
    models: input.models,
    judge_model: input.judgeModel,
    case_ids: input.caseIds,
    repeats: input.repeats,
    total_calls: totalCalls,
    status: 'queued',
  }).returningAll().executeTakeFirstOrThrow());
  const run = runFromRow(row as unknown as Record<string, unknown>);
  try {
    await getAgentEvalQueue().add('run', { runId: run.id }, {
      jobId: run.id,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    });
  } catch (error) {
    await db.tx(trx => trx.updateTable('agent_eval_runs')
      .set({ status: 'failed', error: '测评队列不可用', ended_at: nowIso(), updated_at: nowIso() })
      .where('id', '=', run.id).execute());
    throw error;
  }
  return run;
}

export async function listAgentEvalRuns(db: ScopedDb): Promise<AgentEvalOverview> {
  const [rows, models] = await Promise.all([
    db.tx(trx => trx.selectFrom('agent_eval_runs')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(AGENT_EVAL_RUN_LIMIT)
      .execute()),
    getModelsByUsageTypeAsync('chat'),
  ]);
  const options: AgentEvalModelOption[] = models.map(model => ({ id: model.id, name: model.name }));
  return { runs: rows.map(row => runFromRow(row as unknown as Record<string, unknown>)), models: options };
}

export async function readAgentEvalRun(db: ScopedDb, id: string): Promise<AgentEvalRunView | null> {
  const row = await db.tx(trx => trx.selectFrom('agent_eval_runs').selectAll().where('id', '=', id).executeTakeFirst());
  return row ? runFromRow(row as unknown as Record<string, unknown>) : null;
}

export async function readAgentEvalResults(db: ScopedDb, id: string): Promise<AgentEvalRunResults | null> {
  const run = await readAgentEvalRun(db, id);
  if (!run) return null;
  const rows = await db.tx(trx => trx.selectFrom('agent_eval_results')
    .selectAll()
    .where('run_id', '=', id)
    .orderBy('model_id', 'asc')
    .orderBy('case_id', 'asc')
    .orderBy('repeat', 'asc')
    .execute());
  const results = rows.map(row => resultFromRow(row as unknown as Record<string, unknown>));
  return { results, leaderboard: buildLeaderboard(results) };
}

function buildLeaderboard(results: AgentEvalResultView[]): AgentEvalLeaderboardEntry[] {
  return buildAgentEvalLeaderboard(results.map(result => ({
    modelId: result.modelId,
    hardPassed: result.hardPassed,
    qualityPassed: result.qualityPassed,
    durationMs: result.durationMs,
    firstTokenMs: result.firstTokenMs,
    totalTokens: result.totalTokens,
  })));
}

export async function cancelAgentEvalRun(db: ScopedDb, id: string): Promise<AgentEvalRunView | null> {
  const run = await readAgentEvalRun(db, id);
  if (!run) return null;
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return run;
  if (run.status === 'queued') {
    const row = await db.tx(trx => trx.updateTable('agent_eval_runs')
      .set({ status: 'cancelled', cancel_requested: true, ended_at: nowIso(), updated_at: nowIso() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow());
    await getAgentEvalQueue().remove(id).catch(() => 0);
    return runFromRow(row as unknown as Record<string, unknown>);
  }
  const row = await db.tx(trx => trx.updateTable('agent_eval_runs')
    .set({ cancel_requested: true, updated_at: nowIso() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow());
  return runFromRow(row as unknown as Record<string, unknown>);
}
