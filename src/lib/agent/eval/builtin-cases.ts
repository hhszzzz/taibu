import rawCases from '../../../../scripts/evals/agent-cases.json';
import type { AgentEvalCase } from './types';

/** The shape `scripts/evals/agent-cases.json` keeps; the CLI and the admin runner read the same file. */
interface RawAgentEvalCase {
  id: string;
  tool: string;
  guide: string;
  prompt: string;
  assertions: string[];
  arguments?: Record<string, unknown>;
  chart?: { tool: string; arguments: Record<string, unknown> };
  visual?: boolean;
}

/** Built-in cases, imported from the JSON the CLI evaluates; administrators may edit the database copies. */
export const BUILTIN_AGENT_EVAL_CASES: AgentEvalCase[] = (rawCases as RawAgentEvalCase[]).map((item, index) => ({
  id: item.id,
  tool: item.tool,
  guide: item.guide,
  prompt: item.prompt,
  assertions: [...item.assertions],
  arguments: { ...(item.arguments ?? {}) },
  ...(item.chart ? { chart: { tool: item.chart.tool, arguments: { ...item.chart.arguments } } } : {}),
  ...(item.visual ? { visual: true } : {}),
  builtin: true,
  enabled: true,
  sortOrder: index,
}));

export const BUILTIN_AGENT_EVAL_CASE_IDS: ReadonlySet<string> = new Set(BUILTIN_AGENT_EVAL_CASES.map(item => item.id));
