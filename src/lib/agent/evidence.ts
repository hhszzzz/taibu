/**
 * 回答依据: the knowledge passages, web pages and chart positions an Agent's
 * tools returned, numbered once per conversation. The server stamps each row
 * with `cite` when the tool runs, so the [n] the model writes is the number the
 * reader sees, and an answer cites only what its own task returned. Rows saved
 * before numbering existed continue after the highest number so far; numbers
 * never repeat or go back.
 */
import type { ChatMessage } from '@/types';
import type { AgentPart } from './types';
import { getAgentSearchResults, readAgentCite, type AgentSearchResult } from './tool-presentation';
import { getChartFocus, type ChartFocus } from './chart-interaction';

export type AgentEvidenceKind = 'knowledge' | 'chart' | 'web';
export const AGENT_EVIDENCE_KINDS: readonly AgentEvidenceKind[] = ['knowledge', 'chart', 'web'];

export type AgentEvidence = {
  n: number;
  toolId: string;
  /** The model was given this number, so its answer may cite it. */
  citable: boolean;
} & ({ kind: 'knowledge' | 'web'; result: AgentSearchResult } | { kind: 'chart'; focus: ChartFocus });

/** A stamped number when it moves forward, otherwise the next one. Server and browser share this rule. */
export function nextAgentCitation(previous: number, cite: number | null): number {
  return cite !== null && cite > previous ? cite : previous + 1;
}

/** Evidence in transcript order, numbered after `previous`. */
export function getAgentEvidence(parts: readonly AgentPart[], previous = 0): AgentEvidence[] {
  const evidence: AgentEvidence[] = [];
  let last = previous;
  for (const part of parts) {
    if (part.type !== 'tool') continue;
    const focus = getChartFocus(part);
    if (focus) {
      const cite = readAgentCite((part.output as { cite?: unknown }).cite);
      last = nextAgentCitation(last, cite);
      evidence.push({ n: last, toolId: part.id, citable: cite === last, kind: 'chart', focus });
      continue;
    }
    for (const result of getAgentSearchResults(part) ?? []) {
      last = nextAgentCitation(last, result.cite);
      evidence.push({ n: last, toolId: part.id, citable: result.cite === last, kind: part.name === 'web_search' ? 'web' : 'knowledge', result });
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

export const AGENT_EVIDENCE_LABELS: Record<AgentEvidenceKind, string> = { knowledge: '知识库', chart: '命盘', web: '联网' };

export function getAgentEvidenceTitle(item: AgentEvidence): string {
  return item.kind === 'chart' ? `命盘定位 · ${item.focus.caption}` : item.result.title;
}

/** Numbers an answer may cite, with their titles: what its own task returned and showed the model. */
export function getAgentCitationLabels(parts: readonly AgentPart[]): ReadonlyMap<number, string> {
  return new Map(getAgentEvidence(parts).filter(item => item.citable).map(item => [item.n, getAgentEvidenceTitle(item)]));
}
