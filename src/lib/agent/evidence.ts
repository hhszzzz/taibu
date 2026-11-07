/**
 * 回答依据: the knowledge passages, web pages and drilldowns an Agent's tools
 * returned, numbered once per conversation. The server stamps each row with
 * `cite` when the tool runs, so the [n] the model writes is the number the
 * reader sees, and an answer may cite a source this or an earlier turn returned.
 * Rows saved before numbering existed continue after the highest number so far;
 * numbers never repeat or go back. A drilldown counts only once stamped, so the
 * conversations from before drilldowns were numbered keep their numbers; so do
 * the positions the removed focus_chart tool located.
 */
import type { ChatMessage } from '@/types';
import type { AgentPart } from './types';
import { getAgentSearchResults, readAgentCite, type AgentSearchResult } from './tool-presentation';
import { CHART_SOURCE_KINDS, getChartFocus, getDrilldownFocus, parseChartReference, type ChartFocus } from './chart-interaction';
import { AGENT_CHART_SHORT_NAMES, isAgentChartTool } from './tool-catalog';

export type AgentEvidenceKind = 'knowledge' | 'chart' | 'web';
export const AGENT_EVIDENCE_KINDS: readonly AgentEvidenceKind[] = ['knowledge', 'chart', 'web'];

export type AgentEvidence = {
  n: number;
  toolId: string;
  /** The model was given this number, so its answer may cite it. */
  citable: boolean;
} & ({ kind: 'knowledge' | 'web'; result: AgentSearchResult } | { kind: 'chart'; focus: ChartFocus; chartLabel: string; title: string });

/** A stamped number when it moves forward, otherwise the next one. Server and browser share this rule. */
export function nextAgentCitation(previous: number, cite: number | null): number {
  return cite !== null && cite > previous ? cite : previous + 1;
}

/** The art of a chart position: the result records it, a saved reference names it, and older records say 盘面. */
function chartLabel(output: { chartKind?: unknown }, focus: ChartFocus): string {
  if (typeof output.chartKind === 'string' && isAgentChartTool(output.chartKind)) return AGENT_CHART_SHORT_NAMES[output.chartKind];
  const source = parseChartReference(focus.reference)?.source;
  return source && source !== 'artifact' ? AGENT_CHART_SHORT_NAMES[CHART_SOURCE_KINDS[source]] : AGENT_EVIDENCE_LABELS.chart;
}

/** Evidence in transcript order, numbered after `previous`. */
export function getAgentEvidence(parts: readonly AgentPart[], previous = 0): AgentEvidence[] {
  const evidence: AgentEvidence[] = [];
  let last = previous;
  for (const part of parts) {
    if (part.type !== 'tool') continue;
    const output = (part.output ?? {}) as { cite?: unknown; chartKind?: unknown };
    const cite = readAgentCite(output.cite);
    const located = getChartFocus(part), focus = located ?? (cite === null ? null : getDrilldownFocus(part));
    if (focus) {
      last = nextAgentCitation(last, cite);
      const label = chartLabel(output, focus);
      // A drilldown's title names its art already (八字岁运刑冲合害); a located position's caption does not.
      evidence.push({ n: last, toolId: part.id, citable: cite === last, kind: 'chart', focus, chartLabel: label, title: located ? `${label} · ${focus.caption}` : focus.caption });
      continue;
    }
    for (const result of getAgentSearchResults(part) ?? []) {
      last = nextAgentCitation(last, result.cite);
      evidence.push({ n: last, toolId: part.id, citable: result.cite === last, kind: part.name === 'search_knowledge' ? 'knowledge' : 'web', result });
    }
  }
  return evidence;
}

/** The highest number a conversation has used; a new task numbers its evidence after it. */
export function getAgentCitationBase(messages: readonly Pick<ChatMessage, 'agent'>[]): number {
  return messages.reduce((last, message) => getAgentEvidence(message.agent?.parts ?? [], last).at(-1)?.n ?? last, 0);
}

export function countAgentEvidence(evidence: readonly AgentEvidence[]) {
  const counts: Record<AgentEvidenceKind, number> & { total: number } = { total: evidence.length, knowledge: 0, chart: 0, web: 0 };
  for (const item of evidence) counts[item.kind]++;
  return counts;
}

export const AGENT_EVIDENCE_LABELS: Record<AgentEvidenceKind, string> = { knowledge: '知识库', chart: '盘面', web: '联网' };

export function getAgentEvidenceTitle(item: AgentEvidence): string {
  return item.kind === 'chart' ? item.title : item.result.title;
}

/** Numbers an answer may cite: every source stamped and shown to the model in this conversation. */
export function getConversationCitationLabels(messages: readonly Pick<ChatMessage, 'agent'>[]): ReadonlyMap<number, string> {
  const labels = new Map<number, string>();
  let last = 0;
  for (const message of messages) {
    for (const item of getAgentEvidence(message.agent?.parts ?? [], last)) {
      last = item.n;
      if (item.citable) labels.set(item.n, getAgentEvidenceTitle(item));
    }
  }
  return labels;
}

/** Numbers an answer may cite from one task's own parts; used by evidence summaries and tests. */
export function getAgentCitationLabels(parts: readonly AgentPart[]): ReadonlyMap<number, string> {
  return new Map(getAgentEvidence(parts).filter(item => item.citable).map(item => [item.n, getAgentEvidenceTitle(item)]));
}
