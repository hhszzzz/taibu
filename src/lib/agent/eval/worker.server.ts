import 'server-only';
import type { ScopedDb } from '@/lib/db/context.server';
import { systemDb } from '@/lib/db/context.server';
import { json } from '@/lib/db/sql-helpers';
import { getModelConfigAsync } from '@/lib/server/ai-config';
import { runAgentEvalCase, type AgentEvalCaseOutcome } from './runner.server';
import { readAgentEvalCases, readAgentEvalRun } from './service.server';

/** How often a running evaluation looks for a cancellation request. */
const CANCEL_POLL_MS = 3000;

const nowIso = () => new Date().toISOString();

async function cancelled(db: ScopedDb, runId: string): Promise<boolean> {
  const row = await db.tx(trx => trx.selectFrom('agent_eval_runs')
    .select('cancel_requested')
    .where('id', '=', runId)
    .executeTakeFirst());
  return row?.cancel_requested === true;
}

async function settleRun(db: ScopedDb, runId: string, status: 'completed' | 'failed' | 'cancelled', error?: string) {
  await db.tx(trx => trx.updateTable('agent_eval_runs')
    .set({ status, ended_at: nowIso(), updated_at: nowIso(), ...(error === undefined ? {} : { error: error.slice(0, 2000) }) })
    .where('id', '=', runId)
    .execute());
}

async function storeResult(db: ScopedDb, runId: string, caseId: string, modelId: string, repeat: number, outcome: AgentEvalCaseOutcome) {
  const values = {
    run_id: runId,
    case_id: caseId,
    model_id: modelId,
    repeat,
    hard_passed: outcome.hardPassed,
    quality_passed: outcome.quality?.passed ?? null,
    failed_assertions: json(outcome.failedAssertions.slice(0, 20).map(item => item.slice(0, 2000))) as never,
    answer: outcome.answer.slice(0, 100000),
    judge_response: outcome.judgeResponse?.slice(0, 20000) ?? null,
    tool_trace: json(outcome.toolTrace) as never,
    tool_calls: outcome.toolTrace.length,
    duration_ms: outcome.durationMs,
    first_token_ms: outcome.firstTokenMs,
    input_tokens: outcome.tokens.input,
    output_tokens: outcome.tokens.output,
    total_tokens: outcome.tokens.total,
    error: (outcome.error ?? outcome.judgeError)?.slice(0, 2000) ?? null,
    created_at: nowIso(),
  };
  await db.tx(trx => trx.insertInto('agent_eval_results').values(values)
    .onConflict(oc => oc.columns(['run_id', 'case_id', 'model_id', 'repeat']).doUpdateSet({
      hard_passed: values.hard_passed, quality_passed: values.quality_passed,
      failed_assertions: values.failed_assertions, answer: values.answer,
      judge_response: values.judge_response, tool_trace: values.tool_trace,
      tool_calls: values.tool_calls, duration_ms: values.duration_ms,
      first_token_ms: values.first_token_ms, input_tokens: values.input_tokens,
      output_tokens: values.output_tokens, total_tokens: values.total_tokens,
      error: values.error, created_at: values.created_at,
    }))
    .execute());
  // Progress is the number of stored results, so an at-least-once replay cannot inflate it.
  await db.tx(async (trx) => {
    const stored = await trx.selectFrom('agent_eval_results')
      .select(trx.fn.countAll<string>().as('count'))
      .where('run_id', '=', runId)
      .executeTakeFirst();
    await trx.updateTable('agent_eval_runs')
      .set({ completed_calls: Number(stored?.count ?? 0), updated_at: nowIso() })
      .where('id', '=', runId)
      .execute();
  });
}

/**
 * Executes one evaluation run in the worker: one case after another, never in parallel with another evaluation.
 * Results are written as they settle, so the admin page shows progress and a cancelled run keeps what already
 * finished.
 */
export async function executeAgentEvalRun(runId: string): Promise<void> {
  const db = systemDb();
  const run = await readAgentEvalRun(db, runId);
  if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return;
  if (run.cancelRequested) {
    await settleRun(db, runId, 'cancelled');
    return;
  }
  await db.tx(trx => trx.updateTable('agent_eval_runs')
    .set({ status: 'running', started_at: run.startedAt ?? nowIso(), updated_at: nowIso() })
    .where('id', '=', runId)
    .execute());
  const controller = new AbortController();
  let stopped = false;
  const poll = setInterval(() => {
    void cancelled(db, runId).then(value => {
      if (!value) return;
      stopped = true;
      controller.abort();
    }).catch(() => {});
  }, CANCEL_POLL_MS);
  poll.unref();
  try {
    const configs = await Promise.all(run.models.map(model => getModelConfigAsync(model)));
    const judgeConfig = await getModelConfigAsync(run.judgeModel);
    if (configs.some(config => !config) || !judgeConfig) throw new Error('所选模型不存在或已停用');
    const cases = await readAgentEvalCases(db, run.caseIds);
    if (cases.length !== run.caseIds.length) throw new Error('部分题目已被删除');
    for (const [modelIndex, model] of run.models.entries()) {
      const config = configs[modelIndex];
      if (!config) continue;
      for (const evalCase of cases) {
        for (let repeat = 1; repeat <= run.repeats; repeat += 1) {
          if (stopped || await cancelled(db, runId)) {
            stopped = true;
            await settleRun(db, runId, 'cancelled');
            return;
          }
          const outcome = await runAgentEvalCase({
            evalId: run.id,
            case: evalCase,
            config,
            judge: { config: judgeConfig },
            signal: controller.signal,
          });
          if (stopped) {
            await settleRun(db, runId, 'cancelled');
            return;
          }
          await storeResult(db, runId, evalCase.id, model, repeat, outcome);
        }
      }
    }
    await settleRun(db, runId, stopped || await cancelled(db, runId) ? 'cancelled' : 'completed');
  } catch (error) {
    if (stopped) {
      await settleRun(db, runId, 'cancelled');
      return;
    }
    const message = error instanceof Error && error.message ? error.message : '测评运行失败';
    await settleRun(db, runId, 'failed', message);
    throw error;
  } finally {
    clearInterval(poll);
  }
}
