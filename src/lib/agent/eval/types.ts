/** One evaluation case: a prompt, the Core tool it must use, and what the answer must satisfy. */
export interface AgentEvalCase {
  id: string;
  tool: string;
  guide: string;
  prompt: string;
  assertions: string[];
  arguments: Record<string, unknown>;
  /** A case that first computes a chart and then drills into it with the reference. */
  chart?: { tool: string; arguments: Record<string, unknown> };
  visual?: boolean;
  /** Its method tells the model to ask the user first (推理时柱), so parking the task is the right end. */
  mayAskUser?: boolean;
  builtin?: boolean;
  enabled?: boolean;
  sortOrder?: number;
}

/** One tool call the evaluated model made, in execution order. */
export interface AgentEvalToolCall {
  name: string;
  arguments?: unknown;
  status: 'ok' | 'error';
  durationMs?: number;
  error?: string;
}

export type AgentEvalRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Cases × models × repeats; the API refuses more. */
export const AGENT_EVAL_CALL_LIMIT = 200;
export const AGENT_EVAL_REPEAT_LIMIT = 5;
export const AGENT_EVAL_REPEAT_DEFAULT = 1;

/** A run as the admin page lists it. */
export interface AgentEvalRunView {
  id: string;
  createdBy: string;
  models: string[];
  judgeModel: string;
  caseIds: string[];
  repeats: number;
  totalCalls: number;
  completedCalls: number;
  status: AgentEvalRunStatus;
  cancelRequested: boolean;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

/** One case × model × repeat outcome. */
export interface AgentEvalResultView {
  id: string;
  caseId: string;
  modelId: string;
  repeat: number;
  hardPassed: boolean;
  qualityPassed: boolean | null;
  failedAssertions: string[];
  answer: string;
  judgeResponse: string | null;
  toolTrace: AgentEvalToolCall[];
  toolCalls: number;
  durationMs: number;
  firstTokenMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  error: string | null;
  createdAt: string;
}

/** Per-model aggregates for one evaluation run. */
export interface AgentEvalLeaderboardEntry {
  modelId: string;
  /** Completed executions (one case × repeat each); an implementation error still counts. */
  results: number;
  hardPassed: number;
  hardPassRate: number;
  /** Results the quality judge scored; failed hard checks and judge errors are not scored. */
  qualityJudged: number;
  qualityPassed: number;
  qualityPassRate: number | null;
  meanDurationMs: number;
  p95DurationMs: number;
  meanFirstTokenMs: number | null;
  p95FirstTokenMs: number | null;
  meanTokens: number;
}

/** A model the launch form offers. */
export interface AgentEvalModelOption {
  id: string;
  name: string;
}

/** `GET /api/admin/agent-evals`. */
export interface AgentEvalOverview {
  runs: AgentEvalRunView[];
  models: AgentEvalModelOption[];
}

/** `GET /api/admin/agent-evals/[id]`. */
export interface AgentEvalRunDetail {
  run: AgentEvalRunView;
}

/** `GET /api/admin/agent-evals/[id]/results`. */
export interface AgentEvalRunResults {
  results: AgentEvalResultView[];
  leaderboard: AgentEvalLeaderboardEntry[];
}
