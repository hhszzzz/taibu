'use client';
// 需要读取工作区上下文，在工作区打开“回答依据”

import { BookOpenCheck } from 'lucide-react';
import type { AgentPart } from '@/lib/agent/types';
import { AGENT_EVIDENCE_KINDS, AGENT_EVIDENCE_LABELS } from '@/lib/agent/evidence';
import { useAgentResultWorkspace } from './AgentResultContext';
import { getAgentEvidenceSummary } from './presentation';

/** 依据 3 · 知识库 2 · 命盘 1: what this task returned to cite; the sources themselves live in the workspace. */
export function AgentEvidenceChip({ parts }: { parts: AgentPart[] }) {
    const workspace = useAgentResultWorkspace();
    const evidence = getAgentEvidenceSummary(parts);
    if (!evidence) return null;
    const text = [`依据 ${evidence.total}`, ...AGENT_EVIDENCE_KINDS.filter(kind => evidence[kind]).map(kind => `${AGENT_EVIDENCE_LABELS[kind]} ${evidence[kind]}`)].join(' · ');
    const label = <><BookOpenCheck size={14} aria-hidden="true" /><span>{text}</span></>;
    return workspace
        ? <button type="button" className="agent-evidence-chip" onClick={() => workspace.openResource('evidence')}>{label}</button>
        : <p className="agent-evidence-chip">{label}</p>;
}
